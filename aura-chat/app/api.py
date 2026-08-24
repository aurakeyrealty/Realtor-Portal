"""HTTP surface. Routes depend on ports via the container, never on adapters."""

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app import diagnostics
from app.container import Container
from app.domain import Claims

router = APIRouter()


def container(request: Request) -> Container:
    return request.app.state.container


def _bearer(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


async def presented_token(
    request: Request,
    authorization: str | None = Header(default=None),
) -> str:
    """The token as sent, verified or not.

    /doctor needs this: when the signing key is wrong nothing verifies, and
    that is exactly the moment somebody needs a diagnosis.
    """
    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="login required")
    request.state.auth_token = token
    return token


async def current_claims(
    request: Request,
    authorization: str | None = Header(default=None),
) -> Claims:
    """Bearer token -> verified identity, or 401.

    The token is the portal's own: the app already holds one, so a realtor
    signs in once and Aura Chat is simply another screen.
    """
    c = container(request)
    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="login required")
    claims = await c.auth.verify(token)
    if claims is None:
        raise HTTPException(status_code=401, detail="login required")
    request.state.auth_token = token
    return claims


@router.get("/health")
async def health(request: Request) -> dict:
    """Liveness and readiness, for the platform's probe.

    Public, so it says whether we are serving -- not which secret is missing.
    A stranger learning that TOKEN_SECRET is unset is a stranger learning when
    to try forging one. The detail lives behind /doctor.

    Cheap by construction: the portal probe underneath is cached, because the
    whole point of running outside Apps Script is that our traffic must not
    compete with the realtors' own.
    """
    report = await diagnostics.shallow(container(request))
    return {"status": report.status, "ok": report.status != "down"}


@router.get("/doctor")
async def doctor(
    request: Request, fresh: bool = False, token: str = Depends(presented_token)
) -> dict:
    """Full diagnosis, for a signed-in human working out why an answer failed.

    Uses the caller's own token, so it exercises the same path a question
    takes: the portal accepting our auth, and project data actually coming
    back. "The portal is reachable" and "Aura can read projects" are different
    claims, and only the second one matters to a realtor.
    """
    c = container(request)
    claims = await c.auth.verify(token)
    # ?fresh=1 rebuilds both caches. Slow and rate-limited upstream, so it is a
    # deliberate diagnostic step -- the answer to "I edited the sheet, why is
    # Aura still saying the old thing?"
    report = await diagnostics.deep(c, auth=token, claims=claims, fresh=fresh)
    return {**report.as_dict(), "user": claims.user if claims else None}


@router.get("/me")
async def me(claims: Claims = Depends(current_claims)) -> dict:
    """Proves the auth path end to end without touching project data."""
    return {"user": claims.user, "role": claims.role, "admin": claims.is_admin}
