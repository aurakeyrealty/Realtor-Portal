from collections.abc import AsyncIterator
from typing import Protocol

from app.domain import ChatMode, Claims


class AgentRuntime(Protocol):
    """The model loop: prompt, tool calls, answer. Phase 3.

    Which model answers is configuration inside the runtime, not a port of its
    own -- swapping OpenRouter for Gemini direct is already a model string.
    Swapping the *loop* (PydanticAI for LangGraph, or a hand-rolled one) is what
    this Protocol is for.
    """

    def stream(
        self,
        *,
        question: str,
        claims: Claims,
        auth: str,
        mode: ChatMode,
        history: list[dict],
    ) -> AsyncIterator[dict]: ...

    async def healthy(self) -> bool: ...
