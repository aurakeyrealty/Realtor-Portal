"""What each audience may see. The leak test (AUR-58) in miniature.

Exhaustive over (role x mode) because there are only four combinations and a
leak here is silent: a realtor turns their phone toward a buyer, commission is
on screen, and nothing errors or can be undone.
"""

import pytest

from app.adapters.projects_redacting import RedactingProjectRepo
from app.domain import ADMIN_ONLY, CLIENT_HIDDEN, CONFIDENTIAL_FIELDS, ChatMode, Role, Viewer
from app.domain.project import Project
from tests.fakes import FakeProjectRepo

AUTH = "tok"


def loaded() -> Project:
    """A project with every confidential field populated, so a field that is
    NOT redacted shows up as a real value rather than an empty string."""
    return Project(
        id="AK-0001", name="Reva", city="BRAMPTON", builder="Great Gulf",
        property_type="Townhome", categories=["townhome"], starting_price=899_900,
        status="Focus", builder_login="agent@builder", builder_office="905-000-0000",
        builder_contact="Rep Name", fub_template="tpl", commission="4%",
        internal_notes="push this one", broker_url="https://portal/x",
        website_url="https://public/x",
    )


ALL_VIEWERS = [
    Viewer(role=r, mode=m) for r in (Role.REALTOR, Role.ADMIN) for m in (ChatMode.REALTOR, ChatMode.CLIENT)
]


@pytest.mark.parametrize("viewer", ALL_VIEWERS, ids=lambda v: f"{v.role}-{v.mode}")
def test_every_hidden_field_is_actually_empty(viewer):
    out = loaded().for_viewer(viewer)
    for field in viewer.hidden_fields:
        assert getattr(out, field) == "", f"{field} leaked to {viewer.role}/{viewer.mode}"


@pytest.mark.parametrize("viewer", ALL_VIEWERS, ids=lambda v: f"{v.role}-{v.mode}")
def test_nothing_beyond_the_policy_is_removed(viewer):
    """Over-redaction is a bug too: a realtor who cannot see the builder's
    number has been given a worse tool, quietly."""
    out = loaded().for_viewer(viewer)
    for field in CONFIDENTIAL_FIELDS - viewer.hidden_fields:
        assert getattr(out, field), f"{field} was removed for no reason"


@pytest.mark.parametrize("viewer", ALL_VIEWERS, ids=lambda v: f"{v.role}-{v.mode}")
def test_what_a_project_is_survives_every_audience(viewer):
    out = loaded().for_viewer(viewer)
    assert out.name == "Reva" and out.city == "BRAMPTON" and out.starting_price == 899_900


def test_a_realtor_sees_the_builders_details_but_not_their_login():
    out = loaded().for_viewer(Viewer(role=Role.REALTOR, mode=ChatMode.REALTOR))
    assert out.builder_contact and out.commission
    assert out.builder_login == ""   # other companies' credentials, admin only


def test_admin_entitlement_does_not_buy_back_a_client_hidden_field():
    """An admin in Client Mode is still showing a buyer a screen."""
    out = loaded().for_viewer(Viewer(role=Role.ADMIN, mode=ChatMode.CLIENT))
    for field in CLIENT_HIDDEN:
        assert getattr(out, field) == ""


def test_the_two_policies_are_a_union_not_an_intersection():
    v = Viewer(role=Role.REALTOR, mode=ChatMode.CLIENT)
    assert ADMIN_ONLY <= v.hidden_fields and CLIENT_HIDDEN <= v.hidden_fields


def test_redaction_never_mutates_the_shared_record():
    """The repo caches Project objects; redacting in place would poison the
    cache for every later request."""
    p = loaded()
    p.for_viewer(Viewer(role=Role.REALTOR, mode=ChatMode.CLIENT))
    assert p.commission == "4%"


async def test_a_tool_cannot_obtain_an_unredacted_project():
    """The whole point of the wrapper: not that it filters, but that there is
    no code path returning something it has not filtered."""
    inner = FakeProjectRepo([loaded()])
    repo = RedactingProjectRepo(inner, Viewer(role=Role.REALTOR, mode=ChatMode.CLIENT))
    from app import tools

    for got in (
        await tools.search_projects(repo, auth=AUTH),
        await tools.compare_projects(repo, ["AK-0001"], auth=AUTH),
        await tools.get_recent_projects(repo, auth=AUTH),
        [await tools.get_project(repo, "AK-0001", auth=AUTH)],
    ):
        assert got and all(p.commission == "" and p.builder_login == "" for p in got)


async def test_search_still_filters_on_fields_it_may_not_show():
    """A search may USE a field it must not SHOW. Redacting before filtering
    would silently change which projects come back, by mode."""
    inner = FakeProjectRepo([loaded()])
    repo = RedactingProjectRepo(inner, Viewer(role=Role.REALTOR, mode=ChatMode.CLIENT))
    from app.domain import ProjectFilters

    out = await repo.search(ProjectFilters(city="BRAMPTON"), auth=AUTH)
    assert len(out) == 1 and out[0].status == ""
