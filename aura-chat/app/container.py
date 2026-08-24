"""Composition root -- the ONE place adapters are constructed.

No other module may import from app.adapters. That rule is what keeps the
swap in section 4.3 of the architecture doc a config change: everything above
depends on app.ports, and only this file decides which implementation arrives.
Enforced by tests/test_layering.py, not by memory.
"""

from dataclasses import dataclass

from app.adapters.auth_portal_hmac import PortalHmacAuthVerifier
from app.adapters.portal_client import PortalClient
from app.adapters.projects_exec import ExecApiProjectRepo
from app.config import Settings, load
from app.ports import AgentRuntime, AuthVerifier, ConversationStore, DocumentIndex, ProjectRepo


@dataclass(slots=True)
class Container:
    settings: Settings
    portal: PortalClient
    auth: AuthVerifier
    projects: ProjectRepo | None = None
    store: ConversationStore | None = None  # Phase 4
    documents: DocumentIndex | None = None  # Phase 5
    runtime: AgentRuntime | None = None  # Phase 3

    async def aclose(self) -> None:
        await self.portal.aclose()


def build(settings: Settings | None = None) -> Container:
    cfg = settings or load()
    portal = PortalClient(cfg.exec_url, timeout_s=cfg.exec_timeout_s)
    auth = PortalHmacAuthVerifier(cfg.token_secret, portal, session_ms=cfg.session_ms)
    # project_source is read here and nowhere else. Adding a Postgres adapter
    # later means one more branch in this function.
    projects = ExecApiProjectRepo(portal)
    return Container(settings=cfg, portal=portal, auth=auth, projects=projects)
