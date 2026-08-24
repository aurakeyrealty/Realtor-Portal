"""The project record, as the business means it -- not as a sheet stores it.

Every adapter maps its own storage into this shape, so nothing above the
adapter layer ever learns a tab name, a row number or a column header.
"""

from datetime import date

from pydantic import BaseModel, Field

# Every field that is hidden from somebody. What is hidden from WHOM lives in
# viewer.py; this set exists so a redaction can be checked for completeness --
# adding a confidential field to Project means adding it here and to the right
# audience list in the same commit.
CONFIDENTIAL_FIELDS = frozenset(
    {
        "builder_login",
        "builder_office",
        "builder_contact",
        "fub_template",
        "commission",
        "internal_notes",
        "broker_url",
        "status",
    }
)


class Project(BaseModel):
    """One project, from any source."""

    # identity
    id: str | None = None  # PROJECT ID once populated; None until then
    name: str
    city: str
    builder: str = ""

    # classification
    property_type: str = ""
    address: str = ""
    categories: list[str] = Field(default_factory=list)  # detached/semi/townhome/condo
    status: str = ""
    is_focus: bool = False
    # "Not Available" in the sheet. Carried rather than dropped: search hides
    # these, but "what happened to X?" still has to find one.
    is_available: bool = True

    # commercial
    starting_price: int | None = None
    max_price: int | None = None
    bedrooms: str = ""
    min_bedrooms: int | None = None  # smallest count offered, for "3+ bedrooms"
    deposit_pct: float | None = None
    deposit_schedule: str = ""
    incentives: str = ""
    occupancy: str = ""

    # provenance (AUR-32)
    last_updated: date | None = None
    source_url: str = ""

    # links
    website_url: str = ""
    drive_url: str = ""
    broker_url: str = ""

    # confidential -- see CONFIDENTIAL_FIELDS
    builder_login: str = ""
    builder_office: str = ""
    builder_contact: str = ""
    fub_template: str = ""
    commission: str = ""
    internal_notes: str = ""

    def for_viewer(self, viewer) -> "Project":
        """A copy carrying only what this viewer may see.

        Returns a new object rather than mutating: the same Project may be
        rendered to the realtor and, a moment later, to a buyer.

        The viewer is typed loosely to keep this module free of an import
        cycle; anything exposing `hidden_fields` will do.
        """
        hidden = viewer.hidden_fields
        if not hidden:
            return self
        return self.model_copy(update={f: "" for f in hidden})

    @property
    def is_ai_ready(self) -> bool:
        """AUR-31: the minimum a project needs before Aura may answer about it.

        A project missing these is not hidden -- it is simply never presented as
        a priced, linkable result.
        """
        return bool(self.id and self.name and self.city and self.property_type)


class ProjectFilters(BaseModel):
    """A search expressed as intent, never as storage mechanics.

    This is what makes the ProjectRepo port swappable: the sheet adapter
    filters in Python, a future SQL adapter turns the same object into a WHERE
    clause, and no caller has to know which.
    """

    query: str = ""  # free text over name/builder
    city: str = ""
    builder: str = ""
    categories: list[str] = Field(default_factory=list)
    min_price: int | None = None
    max_price: int | None = None
    min_bedrooms: int | None = None
    max_deposit_pct: float | None = None
    status: str = ""
    occupancy: str = ""
    include_unavailable: bool = False
    limit: int = 20
