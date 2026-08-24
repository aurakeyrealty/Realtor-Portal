"""ASGI entrypoint. `uvicorn app.main:app`."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import container as container_mod
from app.api import router


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


def create_app() -> FastAPI:
    app = FastAPI(title="Aura Chat", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()
