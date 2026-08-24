"""The project record, as the business means it -- not as a sheet stores it.

Every adapter maps its own storage into this shape, so nothing above the
adapter layer ever learns a tab name, a row number or a column header.
"""

from datetime import date

from pydantic import BaseModel, Field

# Fields a buyer may never see over the realtor's shoulder. Client mode strips
# these in code, before the model is called (AUR-55/56). Adding a confidential
# field to Project means adding it here in the same commit.
CONFIDENTIAL_FIELDS = frozenset(
    {
        "builder_login",
        "builder_office",
        "builder_contact",
        "fub_template",
        "commission",
        "internal_notes",
        "broker_url",
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
    categories: list[str] = Field(default_factory=list)  # detached/semi/townhome/condo
    status: str = ""
    is_focus: bool = False

    # commercial
    starting_price: int | None = None
    max_price: int | None = None
    bedrooms: str = ""
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

    def for_client(self) -> "Project":
        """A copy safe to put in front of a buyer.

        Returns a new object rather than mutating: the same Project may be
        rendered to the realtor in the same request.
        """
        return self.model_copy(update={f: "" for f in CONFIDENTIAL_FIELDS})

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
