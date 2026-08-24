"""The tools, against a fake repo. No network, no model, no sheet."""

import pytest

from app import tools
from app.adapters.projects_redacting import RedactingProjectRepo
from app.domain import ChatMode, Project, Role, Viewer
from tests.fakes import FakeProjectRepo

AUTH = "tok"


def p(name, **over) -> Project:
    base = dict(
        id=name.lower(), name=name, city="BRAMPTON", builder="Great Gulf",
        property_type="Townhome", categories=["townhome"], starting_price=899_900,
        min_bedrooms=3, deposit_pct=10.0, is_available=True,
        builder_login="agent@builder", commission="4%",
    )
    base.update(over)
    return Project(**base)


@pytest.fixture
def repo():
    return FakeProjectRepo(
        [
            p("Reva", starting_price=899_900),
            p("Kai", starting_price=1_250_000, categories=["detached"]),
            p("Solera", starting_price=None),
            p("Gone", is_available=False),
        ]
    )


async def test_search_returns_domain_objects(repo):
    out = await tools.search_projects(repo, auth=AUTH, city="BRAMPTON")
    assert out and all(isinstance(x, Project) for x in out)


async def test_a_redacting_repo_is_what_makes_a_tool_safe(repo):
    """Tools have no redaction step. They are handed a repo that cannot return
    an unredacted record, so a tool added in a hurry cannot forget one."""
    client_view = RedactingProjectRepo(repo, Viewer(role=Role.REALTOR, mode=ChatMode.CLIENT))
    out = await tools.search_projects(client_view, auth=AUTH)
    assert out and all(x.commission == "" for x in out)


async def test_the_same_tool_over_a_realtor_view_keeps_the_field(repo):
    realtor_view = RedactingProjectRepo(repo, Viewer(role=Role.REALTOR, mode=ChatMode.REALTOR))
    out = await tools.search_projects(realtor_view, auth=AUTH)
    assert any(x.commission for x in out)


async def test_results_are_capped(repo):
    """One question must never drag the whole sheet into a prompt (AUR-17)."""
    big = FakeProjectRepo([p(f"P{i}") for i in range(100)])
    out = await tools.search_projects(big, auth=AUTH, limit=999)
    assert len(out) <= tools.MAX_RESULTS


async def test_compare_is_capped_and_skips_unknown_ids(repo):
    out = await tools.compare_projects(repo, ["reva", "kai", "nope"], auth=AUTH)
    assert [x.name for x in out] == ["Reva", "Kai"]


async def test_get_project_returns_none_for_an_unknown_id(repo):
    assert await tools.get_project(repo, "nope", auth=AUTH) is None


async def test_get_project_is_redacted_by_the_repo_it_is_given(repo):
    client_view = RedactingProjectRepo(repo, Viewer(role=Role.REALTOR, mode=ChatMode.CLIENT))
    out = await tools.get_project(client_view, "reva", auth=AUTH)
    assert out is not None and out.commission == ""


async def test_search_can_ask_for_focus_projects():
    """30 projects carry the brokerage's own priority flag. It was sortable
    from the start but not askable, so Aura answered "I can't search for focus
    projects" about a signal every other surface exposes."""
    mixed = FakeProjectRepo([p("Pushed", is_focus=True), p("Ordinary", is_focus=False)])
    out = await tools.search_projects(mixed, auth=AUTH, focus_only=True)
    assert [x.name for x in out] == ["Pushed"]


async def test_search_without_focus_returns_both():
    mixed = FakeProjectRepo([p("Pushed", is_focus=True), p("Ordinary", is_focus=False)])
    assert len(await tools.search_projects(mixed, auth=AUTH)) == 2
