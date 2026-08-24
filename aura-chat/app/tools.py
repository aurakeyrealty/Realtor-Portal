"""What the model is allowed to do.

Plain async functions over the ports. No framework import, no adapter import,
no knowledge of where data lives -- so the agent framework in agent.py can be
replaced without touching a line here, and so can the data source.

Every tool is read-only by construction: ProjectRepo has no write method to
call (AUR-19).
"""

from app.domain import Project, ProjectFilters
from app.ports import ProjectRepo

# One question must never drag the whole sheet into a prompt. The model gets the
# records a tool returned and nothing else (AUR-17), so the cap is both a token
# budget and the blast radius of a badly-worded search.
MAX_RESULTS = 12
MAX_COMPARE = 4


# There is no redaction step in this file, deliberately. The repo handed to
# these functions is a RedactingProjectRepo built from the caller's verified
# claims, so an unredacted Project is not something a tool can obtain -- rather
# than something a tool must remember to avoid. See adapters/projects_redacting.
async def search_projects(
    repo: ProjectRepo,
    *,
    auth: str,
    city: str = "",
    builder: str = "",
    categories: list[str] | None = None,
    min_price: int | None = None,
    max_price: int | None = None,
    min_bedrooms: int | None = None,
    max_deposit_pct: float | None = None,
    occupancy: str = "",
    query: str = "",
    limit: int = MAX_RESULTS,
) -> list[Project]:
    """Find projects matching a brief (AUR-25).

    categories are the portal's own buckets: detached, semi, townhome, condo.
    """
    filters = ProjectFilters(
        city=city,
        builder=builder,
        categories=categories or [],
        min_price=min_price,
        max_price=max_price,
        min_bedrooms=min_bedrooms,
        max_deposit_pct=max_deposit_pct,
        occupancy=occupancy,
        query=query,
        limit=min(limit, MAX_RESULTS),
    )
    return await repo.search(filters, auth=auth)


async def get_project(repo: ProjectRepo, project_id: str, *, auth: str) -> Project | None:
    """One project's current record (AUR-26)."""
    return await repo.get(project_id, auth=auth)


async def compare_projects(
    repo: ProjectRepo, project_ids: list[str], *, auth: str
) -> list[Project]:
    """Several projects side by side (AUR-27).

    Returns records, not prose: the table is the answer, and letting the model
    restate numbers is how numbers drift.
    """
    found = [await repo.get(pid, auth=auth) for pid in project_ids[:MAX_COMPARE]]
    return [p for p in found if p is not None]


async def get_recent_projects(
    repo: ProjectRepo,
    days: int = 7,
    *,
    auth: str,
    limit: int = MAX_RESULTS,
) -> list[Project]:
    """What changed lately (AUR-28).

    Ordered by the sheet's own LAST UPDATED, so it is only as honest as that
    column. An unfilled column means an empty answer, which is the correct
    answer -- not a guess from cache timestamps.
    """
    return await repo.recent(days, auth=auth, limit=min(limit, MAX_RESULTS))
