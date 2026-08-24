"""ProjectRepo backed by the portal's Apps Script API.

This is the only file in the service that knows a sheet column exists. Header
names, row numbers and "$899,900" all stop at `_to_project`; everything above
sees `Project`. That containment is what makes moving to a database a matter of
writing a sibling adapter rather than touching tools, prompts or the API.
"""

import time

from app.domain import Project, ProjectFilters, matches, sort_key

from .parsing import (
    parse_date,
    parse_min_bedrooms,
    parse_money,
    parse_percent,
    parse_price_range,
    slugify,
)
from .portal_client import PortalClient, PortalError


class ExecApiProjectRepo:
    # The portal rebuilds this index at most every few hours and Sudhanshu edits
    # the sheets live during the sprint, so the window is a compromise between a
    # stale demo and portal runtime -- a budget shared with the realtors' own
    # app. Five minutes is roughly one fetch per conversation rather than one
    # per question.
    TTL_S = 300.0

    def __init__(self, portal: PortalClient, *, ttl_s: float | None = None) -> None:
        self._portal = portal
        self._ttl = self.TTL_S if ttl_s is None else ttl_s
        self._cached: list[Project] | None = None
        self._fetched_at = 0.0
        # Counted, not logged: a spike in unparsed prices means Sudhanshu has
        # started writing them a new way, and /doctor should say so before a
        # realtor finds out by getting a wrong answer.
        self.unparsed_prices = 0
        self.total_rows = 0

    # -- port ----------------------------------------------------------------

    async def search(self, filters: ProjectFilters, *, auth: str) -> list[Project]:
        rows = await self._index(auth)
        hits = [p for p in rows if matches(p, filters)]
        hits.sort(key=sort_key)
        return hits[: filters.limit]

    async def get(self, project_id: str, *, auth: str) -> Project | None:
        rows = await self._index(auth)
        # Unavailable projects are reachable by id on purpose: search hides them,
        # but "what happened to X?" still needs an answer.
        return next((p for p in rows if p.id == project_id), None)

    async def recent(self, days: int, *, auth: str, limit: int = 20) -> list[Project]:
        rows = await self._index(auth)
        dated = [p for p in rows if p.last_updated is not None and p.is_available]
        dated.sort(key=lambda p: p.last_updated, reverse=True)
        if not dated:
            return []
        cutoff = dated[0].last_updated.toordinal() - days
        return [p for p in dated if p.last_updated.toordinal() >= cutoff][:limit]

    async def healthy(self) -> bool:
        return await self._portal.healthy()

    # -- cache ---------------------------------------------------------------

    def invalidate(self) -> None:
        self._cached = None

    async def _index(self, auth: str) -> list[Project]:
        """The whole project set, cached in this process.

        One payload rather than a filtered query per question: filtering happens
        in Python, so a busy conversation costs one portal fetch per window.

        Known limit: the cache is per process. If this ever runs on more than one
        worker, each keeps its own copy and the portal sees one fetch per worker
        per window. At this team's size we do not scale out; revisit if we do.
        """
        now = time.monotonic()
        if self._cached is not None and now - self._fetched_at < self._ttl:
            return self._cached
        data = await self._portal.call("aiindex", auth=auth)
        if data.get("ok") is False:
            raise PortalError(str(data.get("error") or "portal refused aiindex"))
        rows = data.get("rows") or []
        parsed, unparsed = [], 0
        for raw in rows:
            project = self._to_project(raw)
            if project is None:
                continue
            if raw.get("price") and project.starting_price is None:
                unparsed += 1
            parsed.append(project)
        self._cached = parsed
        self._fetched_at = now
        self.unparsed_prices = unparsed
        self.total_rows = len(parsed)
        return parsed

    # -- mapping: the containment boundary ------------------------------------

    @staticmethod
    def _to_project(raw: dict) -> Project | None:
        name = str(raw.get("project") or "").strip()
        city = str(raw.get("city") or "").strip()
        if not name or not city:
            return None

        low = parse_money(raw.get("price"))
        high = parse_money(raw.get("maxprice"))
        if low is None:
            # Some tabs carry one PRICE RANGE column instead of two.
            low, span_high = parse_price_range(raw.get("price"))
            high = high if high is not None else span_high

        return Project(
            # A real PROJECT ID always wins; the slug is scaffolding until
            # Sudhanshu's column is filled, and changes if a project is renamed.
            id=str(raw.get("id") or "").strip() or slugify(city, name),
            name=name,
            city=city,
            builder=str(raw.get("builder") or "").strip(),
            property_type=str(raw.get("type") or "").strip(),
            address=str(raw.get("address") or "").strip(),
            categories=list(raw.get("cats") or []),
            status=str(raw.get("status") or "").strip(),
            is_focus=bool(raw.get("focus")),
            is_available=not bool(raw.get("hidden")),
            starting_price=low,
            max_price=high,
            bedrooms=str(raw.get("beds") or "").strip(),
            min_bedrooms=parse_min_bedrooms(raw.get("beds")),
            deposit_pct=parse_percent(raw.get("depositpct")),
            deposit_schedule=str(raw.get("depositsched") or "").strip(),
            incentives=str(raw.get("incentives") or "").strip(),
            occupancy=str(raw.get("occupancy") or "").strip(),
            last_updated=parse_date(raw.get("lastupdated")),
            source_url=str(raw.get("sourceurl") or "").strip(),
            website_url=str(raw.get("website_url") or "").strip(),
            drive_url=str(raw.get("drive_url") or "").strip(),
            broker_url=str(raw.get("broker_url") or "").strip(),
            builder_login=str(raw.get("login") or "").strip(),
            builder_office=str(raw.get("office") or "").strip(),
            builder_contact=str(raw.get("contact") or "").strip(),
            fub_template=str(raw.get("fub") or "").strip(),
        )
