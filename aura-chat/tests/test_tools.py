"""The tools, against a fake repo. No network, no model, no sheet."""

import pytest

from app import tools
from app.domain import ChatMode, Project
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


async def test_client_mode_strips_before_the_model_sees_anything(repo):
    """AUR-55: in code, not by asking the model to withhold it."""
    out = await tools.search_projects(repo, auth=AUTH, mode=ChatMode.CLIENT)
    assert out
    assert all(x.builder_login == "" and x.commission == "" for x in out)


async def test_realtor_mode_keeps_confidential_fields(repo):
    out = await tools.search_projects(repo, auth=AUTH, mode=ChatMode.REALTOR)
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


async def test_get_project_applies_client_mode(repo):
    out = await tools.get_project(repo, "reva", auth=AUTH, mode=ChatMode.CLIENT)
    assert out is not None and out.commission == ""
