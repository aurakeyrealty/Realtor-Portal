"""Environment-backed configuration. The only module that reads os.environ."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- auth -------------------------------------------------------------
    # Shared with the Apps Script project. There is deliberately no default:
    # signing or verifying with a placeholder would let anyone holding the
    # source forge a realtor -- or an admin -- session. Missing means refuse.
    token_secret: str = ""
    # Must match SESSION_MS in Core.js. A longer window here would keep
    # honouring tokens the portal has already retired.
    session_ms: int = 7 * 24 * 60 * 60 * 1000

    # --- portal (data plane) ---------------------------------------------
    exec_url: str = ""
    exec_timeout_s: float = 30.0

    # --- browser clients --------------------------------------------------
    # The PWA is on another origin, so the browser blocks its POST unless this
    # service names that origin. A wildcard would let any page a realtor happens
    # to visit spend their token, so this is an explicit list; the default names
    # only the local dev hosts, and production is added in the host's env.
    allowed_origins: str = "http://localhost:4600,http://localhost:4599"
    # Netlify mints a fresh random subdomain for every draft deploy, so previews
    # can never be named in the list above. Empty by default: a regex here is a
    # standing hole in the allowlist and should exist only while previews are
    # actually being tested.
    allowed_origin_regex: str = ""

    # --- model (Phase 3) --------------------------------------------------
    openrouter_api_key: str = ""
    llm_model: str = "google/gemini-2.5-flash"
    # A ceiling on the answer, not a target. Left unset, providers advertise
    # their whole context as max_tokens (65k on Gemini Flash), which OpenRouter
    # bills against up front -- a request can be refused for lack of credit to
    # cover an answer nobody wanted. Aura is told to reply in two or three
    # sentences, so this is generous even for a long comparison.
    llm_max_tokens: int = 1500

    # --- storage (Phase 4) ------------------------------------------------
    database_url: str = ""

    # --- wiring -----------------------------------------------------------
    # Which adapter backs ProjectRepo. The whole point of the port: moving
    # project data off Sheets is this string, not a rewrite.
    project_source: str = "exec"

    @property
    def origins(self) -> list[str]:
        """The allowlist, split and cleaned.

        A stray blank from a trailing comma would be an origin no browser ever
        sends, but "" is also what a same-origin request carries in some
        engines -- dropping empties keeps the list meaning exactly what it says.
        """
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def auth_ready(self) -> bool:
        return bool(self.token_secret)

    @property
    def portal_ready(self) -> bool:
        return bool(self.exec_url)


def load() -> Settings:
    return Settings()
