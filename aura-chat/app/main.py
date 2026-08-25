"""ASGI entrypoint. `uvicorn app.main:app`."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import container as container_mod
from app.api import router
from app.chat import router as chat_router
from app.config import Settings, load


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Build the container on startup -- unless one was injected.

    Tests set app.state.container before the app starts; building over it here
    would silently replace their fakes with real adapters reading the real
    environment, which is a confusing way to discover you have no .env file.
    Whoever supplied the container owns closing it.
    """
    owned = getattr(app.state, "container", None) is None
    if owned:
        app.state.container = container_mod.build()
    try:
        yield
    finally:
        if owned:
            await app.state.container.aclose()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the ASGI app.

    Settings arrive here as well as in the container because CORS is middleware:
    it has to be registered while the app is being constructed, and the container
    is not built until startup. Passing them in also lets a test pin an origin
    list instead of inheriting whatever .env happens to say.
    """
    cfg = settings or load()
    app = FastAPI(title="Aura Chat", version="0.1.0", lifespan=lifespan)
    # allow_credentials stays False: the token travels in the Authorization
    # header, never a cookie, so credentialed CORS buys nothing -- and with it
    # off, a mistake in the list cannot hand a third-party page a live session.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.origins,
        allow_origin_regex=cfg.allowed_origin_regex or None,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(router)
    app.include_router(chat_router)
    return app


app = create_app()
