"""The chat endpoint: one question in, a stream of events out.

Server-Sent Events rather than a single JSON reply, because the alternative on a
phone is five to ten seconds of blank spinner. SSE is also the reason this
service exists outside Apps Script, which cannot stream at all.
"""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api import container, current_claims
from app.domain import MAX_HISTORY_TURNS, ChatMode, Claims, Turn, Viewer

router = APIRouter()


class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    mode: ChatMode = ChatMode.REALTOR
    conversation_id: str | None = None  # honoured in Phase 4
    # Client-supplied until Phase 4 stores conversations server-side and keys
    # them on conversation_id. It is the caller's own conversation replayed to
    # the caller's own agent, so it grants no access they do not already have --
    # but it is still the client asserting what was said, which is why it is
    # capped and why the server-side store replaces it rather than joining it.
    history: list[Turn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/chat")
async def chat(
    body: Ask, request: Request, claims: Claims = Depends(current_claims)
) -> StreamingResponse:
    """Ask Aura something.

    The mode arrives from the client because it is a UI state, not an account
    property — but nothing downstream trusts the client with it beyond this
    point: it selects a Viewer here, and the repo built from that Viewer is the
    only way the agent can reach project data.
    """
    c = container(request)
    token = request.state.auth_token
    viewer = Viewer.of(claims, body.mode)

    async def events() -> AsyncIterator[str]:
        # Everything that can fail happens in here, so every failure reaches the
        # client in the shape it is reading. A misconfigured repo raising out
        # here would 500 with an HTML body to a caller that asked for an event
        # stream, while the identical misconfiguration of the runtime, two lines
        # down, would arrive as a readable error.
        try:
            if c.runtime is None:
                yield _sse({"type": "error", "detail": "the model is not configured"})
                return
            repo = c.projects_for(viewer)
        except Exception as exc:
            yield _sse({"type": "error", "detail": f"{type(exc).__name__}: {exc}"})
            return
        # The mode is echoed first so the UI can prove which one it is in before
        # any content arrives — a realtor must never wonder whether the screen
        # they just turned around is safe.
        yield _sse({"type": "start", "mode": body.mode})
        try:
            async for event in c.runtime.stream(
                question=body.question,
                claims=claims,
                auth=token,
                mode=body.mode,
                repo=repo,
                history=body.history,
            ):
                yield _sse(event)
        except Exception as exc:
            # The port promises an iterator of events, not that it never raises.
            # A stream that simply stops leaves a conforming client waiting
            # under a finished answer.
            yield _sse({"type": "error", "detail": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # Without this an intermediary may buffer the whole response and hand it
        # over at the end, which looks exactly like no streaming at all.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
