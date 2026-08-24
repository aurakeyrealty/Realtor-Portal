"""AgentRuntime on PydanticAI.

The ONLY file in the service that imports an agent framework. Tools here are
thin wrappers over app.tools, which know nothing about PydanticAI -- so swapping
this for LangGraph, the OpenAI Agents SDK or a hand-rolled loop is a rewrite of
this file and nothing else.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openrouter import OpenRouterProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

from app import tools
from app.domain import ChatMode, Claims, Project
from app.ports import ProjectRepo
from app.prompts import system_prompt

# A hard stop on the tool loop. Without it a model that keeps re-searching turns
# one question into an unbounded bill and a realtor watching a spinner: the
# framework's own default is 50 round trips, which is not a limit anyone chose.
MAX_STEPS = 6
LIMITS = UsageLimits(request_limit=MAX_STEPS)


@dataclass
class Deps:
    """Everything a tool needs, carried through the run.

    `repo` is already a RedactingProjectRepo built for this viewer, so a tool
    here cannot reach an unredacted record even by accident.
    """

    repo: ProjectRepo
    auth: str
    # Tool results, kept as they are produced. The UI renders cards from THESE,
    # not from the model's prose -- restating numbers is how numbers drift.
    collected: list[Project] = field(default_factory=list)


def _for_model(p: Project) -> dict[str, Any]:
    """One project as the model should see it.

    Empty fields are dropped rather than sent as "": a page of blanks teaches a
    model that missing data is normal and invites it to fill the gaps. What is
    absent should be absent.
    """
    out: dict[str, Any] = {"id": p.id, "name": p.name, "city": p.city}
    optional = {
        "builder": p.builder,
        "type": p.property_type,
        "starting_price": p.starting_price,
        "max_price": p.max_price,
        "bedrooms": p.bedrooms,
        "deposit_percent": p.deposit_pct,
        "deposit_schedule": p.deposit_schedule,
        "incentives": p.incentives,
        "occupancy": p.occupancy,
        "address": p.address,
        "last_updated": p.last_updated.isoformat() if p.last_updated else None,
        "source": p.source_url,
    }
    out.update({k: v for k, v in optional.items() if v not in ("", None)})
    return out


def build_agent(model: Model | str, *, client_mode: bool, max_tokens: int = 1500) -> Agent:
    agent = Agent(
        model,
        deps_type=Deps,
        instructions=system_prompt(client_mode=client_mode),
        retries=1,
        model_settings=ModelSettings(max_tokens=max_tokens),
    )

    def _keep(ctx: RunContext[Deps], found: list[Project]) -> list[dict[str, Any]]:
        # Each id joins `seen` as it is accepted, not from a snapshot taken
        # beforehand: two rows can share a PROJECT ID while the column is being
        # entered by hand, and the realtor would otherwise get the same card
        # twice with no way to tell which row is authoritative.
        seen = {p.id for p in ctx.deps.collected}
        for p in found:
            if p.id not in seen:
                seen.add(p.id)
                ctx.deps.collected.append(p)
        return [_for_model(p) for p in found]

    @agent.tool
    async def search_projects(
        ctx: RunContext[Deps],
        city: str = "",
        builder: str = "",
        categories: list[str] | None = None,
        min_price: int | None = None,
        max_price: int | None = None,
        min_bedrooms: int | None = None,
        max_deposit_percent: float | None = None,
        occupancy: str = "",
        query: str = "",
    ) -> list[dict[str, Any]]:
        """Find projects matching a brief.

        categories are: detached, semi, townhome, condo. Prices are whole
        dollars. Put every constraint in one call rather than searching twice.
        """
        found = await tools.search_projects(
            ctx.deps.repo,
            auth=ctx.deps.auth,
            city=city,
            builder=builder,
            categories=categories,
            min_price=min_price,
            max_price=max_price,
            min_bedrooms=min_bedrooms,
            max_deposit_pct=max_deposit_percent,
            occupancy=occupancy,
            query=query,
        )
        return _keep(ctx, found)

    @agent.tool
    async def get_project(ctx: RunContext[Deps], project_id_or_name: str) -> dict[str, Any]:
        """The current record for one project, by id or by its exact name.

        If the name is not exact, or two projects share it, this returns
        found=false -- use search_projects, do not conclude the project does not
        exist.
        """
        found = await tools.get_project(ctx.deps.repo, project_id_or_name, auth=ctx.deps.auth)
        if found is not None:
            return {"found": True, **_keep(ctx, [found])[0]}

        # A bare null reads to a model as "no such project", which is how Aura
        # came to deny that projects in its own sheet existed. Telling it to go
        # and search was not enough -- it often did not. So do the search here
        # and hand back what turned up: two Brampton projects really are both
        # called "Mayfield Village", and the realtor needs to be asked which,
        # not told neither exists.
        near = await tools.search_projects(
            ctx.deps.repo, auth=ctx.deps.auth, query=project_id_or_name
        )
        return {
            "found": False,
            "reason": "no exact id or unique name match",
            "candidates": _keep(ctx, near),
            "next": "ask the realtor which of the candidates they mean; do not say the project does not exist",
        }

    @agent.tool
    async def compare_projects(
        ctx: RunContext[Deps], project_ids: list[str]
    ) -> list[dict[str, Any]]:
        """Two or more projects side by side, by id."""
        found = await tools.compare_projects(ctx.deps.repo, project_ids, auth=ctx.deps.auth)
        return _keep(ctx, found)

    @agent.tool
    async def get_recent_projects(ctx: RunContext[Deps], days: int = 7) -> list[dict[str, Any]]:
        """Projects updated in the last N days. Empty means nothing changed."""
        found = await tools.get_recent_projects(ctx.deps.repo, days, auth=ctx.deps.auth)
        return _keep(ctx, found)

    return agent


class PydanticAgentRuntime:
    def __init__(
        self,
        *,
        api_key: str,
        model_name: str,
        model: Model | None = None,
        max_tokens: int = 1500,
    ) -> None:
        self._api_key = api_key
        self._model_name = model_name
        self._max_tokens = max_tokens
        # Injected in tests as a scripted model, so the whole loop can be
        # exercised without a network call or a bill.
        self._model = model
        self._built: Model | None = None
        # One agent per mode, built on first use. A provider owns an AsyncOpenAI
        # client and its connection pool, and nothing here closes one -- building
        # them per request leaves a pool per message until the process runs out
        # of sockets. Tool registration is per-agent too, so this also stops four
        # tools being re-registered on every question.
        self._agents: dict[bool, Agent] = {}

    def _model_for(self) -> Model | str:
        if self._model is not None:
            return self._model
        if self._built is None:
            self._built = OpenAIChatModel(
                self._model_name, provider=OpenRouterProvider(api_key=self._api_key)
            )
        return self._built

    def _agent_for(self, client_mode: bool) -> Agent:
        """Two agents at most: the instructions differ by mode, nothing else.

        Safe to share across requests because everything request-specific --
        the repo, the token, the collected results -- travels in Deps.
        """
        if client_mode not in self._agents:
            self._agents[client_mode] = build_agent(
                self._model_for(), client_mode=client_mode, max_tokens=self._max_tokens
            )
        return self._agents[client_mode]

    async def stream(
        self,
        *,
        question: str,
        claims: Claims,
        auth: str,
        mode: ChatMode,
        repo: ProjectRepo,
        history: list[Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Answer one question, emitting events as they happen.

        Text is streamed so the realtor sees work happening rather than a frozen
        screen. The project cards are emitted at the end from the TOOL results,
        never parsed back out of the model's prose.
        """
        deps = Deps(repo=repo, auth=auth)
        agent = self._agent_for(mode is ChatMode.CLIENT)
        try:
            async with agent.run_stream(
                question,
                deps=deps,
                message_history=history or None,
                usage_limits=LIMITS,
            ) as result:
                async for chunk in result.stream_text(delta=True):
                    if chunk:
                        yield {"type": "text", "text": chunk}
            # Inside the guard: serialising the cards can fail too, and a stream
            # that ends after the text with no `done` leaves a conforming client
            # waiting under a finished answer.
            cards = [_for_model(p) for p in deps.collected]
        except Exception as exc:
            # The realtor gets a recoverable message, not a stack trace and not
            # a half-answer that reads like a complete one (AUR-45).
            yield {"type": "error", "detail": f"{type(exc).__name__}: {exc}"}
            return
        yield {"type": "projects", "projects": cards}
        yield {"type": "done"}

    async def healthy(self) -> bool:
        """Configuration only, deliberately.

        A real completion would be the stronger check and would also spend money
        on every uptime probe. Reachability is what /doctor is for.
        """
        return bool(self._api_key or self._model is not None)
