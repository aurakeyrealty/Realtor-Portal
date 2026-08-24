from typing import Protocol


class ConversationStore(Protocol):
    """Chat history. Phase 4 -- the Protocol is declared now so tools and API
    can be written against it, and so the fake exists for tests."""

    async def create(self, *, user: str, title: str) -> str: ...

    async def append(
        self, *, conversation_id: str, role: str, message: str, sources: list[dict] | None = None
    ) -> None: ...

    async def history(self, *, conversation_id: str, user: str) -> list[dict]: ...

    async def list_for(self, *, user: str, limit: int = 30) -> list[dict]: ...

    async def healthy(self) -> bool: ...
