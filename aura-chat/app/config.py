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

    # --- model (Phase 3) --------------------------------------------------
    openrouter_api_key: str = ""
    llm_model: str = "google/gemini-2.5-flash"

    # --- storage (Phase 4) ------------------------------------------------
    database_url: str = ""

    # --- wiring -----------------------------------------------------------
    # Which adapter backs ProjectRepo. The whole point of the port: moving
    # project data off Sheets is this string, not a rewrite.
    project_source: str = "exec"

    @property
    def auth_ready(self) -> bool:
        return bool(self.token_secret)

    @property
    def portal_ready(self) -> bool:
        return bool(self.exec_url)


def load() -> Settings:
    return Settings()
