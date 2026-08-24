from app.domain import Project
from app.domain.project import CONFIDENTIAL_FIELDS


def a_project(**over) -> Project:
    base = dict(
        id="AK-0001", name="Reva Westfield", city="BRAMPTON", builder="Great Gulf",
        property_type="Townhome", categories=["townhome"], starting_price=899900,
        builder_login="agent@builder", commission="4%", internal_notes="push this one",
        broker_url="https://portal.example/x", website_url="https://public.example/x",
    )
    base.update(over)
    return Project(**base)


def test_client_mode_strips_every_confidential_field():
    """AUR-55: stripped in code, before the model is called -- never by asking
    the model to withhold it."""
    safe = a_project().for_client()
    for field in CONFIDENTIAL_FIELDS:
        assert getattr(safe, field) == "", field


def test_client_mode_keeps_what_a_buyer_may_see():
    safe = a_project().for_client()
    assert safe.name == "Reva Westfield"
    assert safe.starting_price == 899900
    assert safe.website_url


def test_client_mode_does_not_mutate_the_original():
    """The same project may be rendered to the realtor in the same request."""
    p = a_project()
    p.for_client()
    assert p.commission == "4%"


def test_ai_ready_requires_an_id():
    """AUR-31 -- a project with no PROJECT ID is never presented as linkable."""
    assert a_project().is_ai_ready
    assert not a_project(id=None).is_ai_ready
