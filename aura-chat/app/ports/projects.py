from typing import Protocol

from app.domain import Project, ProjectFilters


class ProjectRepo(Protocol):
    """Project data, wherever it lives.

    Filtering, sorting and limiting all happen behind this port. A caller that
    fetches everything and filters it itself works today -- the sheet returns
    everything anyway -- and silently blocks the move to SQL, where the same
    filter should become a WHERE clause.
    """

    async def search(self, filters: ProjectFilters, *, auth: str) -> list[Project]: ...

    async def get(self, project_id: str, *, auth: str) -> Project | None: ...

    async def recent(self, days: int, *, auth: str, limit: int = 20) -> list[Project]: ...

    async def refresh(self, *, auth: str) -> int:
        """Drop any caching and re-read, returning how many projects came back.

        A capability, not a leak of how the adapter stores things: a repo with
        no cache implements this as an ordinary read. It exists because a sheet
        edit is invisible until a cache turns over, and 'wait six hours' is not
        an answer during a sprint.
        """
        ...

    async def healthy(self) -> bool: ...
