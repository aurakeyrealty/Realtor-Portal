"""The SSE contract the PWA will consume."""

import json

from fastapi.testclient import TestClient

from app.domain import ChatMode, Project
from tests.fakes import FakeProjectRepo, make_token

TOKEN = make_token("sarath")


class StubRuntime:
    def __init__(self, events=None):
        self.events = events or [{"type": "text", "text": "hi"}, {"type": "done"}]
        self.seen: dict = {}

    async def stream(self, *, question, claims, auth, mode, repo, history=None):
        self.seen = {
            "question": question, "mode": mode, "auth": auth,
            "repo": repo, "history": history or [],
        }
        for e in self.events:
            yield e

    async def healthy(self):
        return True


def wire(app, runtime=None, projects=None):
    app.state.container.runtime = runtime or StubRuntime()
    app.state.container.projects = FakeProjectRepo(projects or [Project(name="R", city="C")])
    return app.state.container.runtime


def sse(text: str) -> list[dict]:
    return [json.loads(l[6:]) for l in text.splitlines() if l.startswith("data: ")]


def test_chat_requires_a_token(app):
    wire(app)
    with TestClient(app) as client:
        assert client.post("/chat", json={"question": "hi"}).status_code == 401


def test_chat_streams_events(app):
    wire(app)
    with TestClient(app) as client:
        r = client.post("/chat", json={"question": "hi"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    kinds = [e["type"] for e in sse(r.text)]
    assert kinds[0] == "start" and kinds[-1] == "done"


def test_the_mode_is_echoed_before_any_content(app):
    """A realtor must never wonder whether the screen they just turned around
    is safe, so the answer states its mode before it says anything else."""
    wire(app)
    with TestClient(app) as client:
        r = client.post(
            "/chat",
            json={"question": "hi", "mode": "client"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    first = sse(r.text)[0]
    assert first == {"type": "start", "mode": "client"}


def test_the_runtime_is_handed_a_repo_narrowed_to_the_viewer(app):
    """The client sends the mode, but nothing downstream trusts it with more
    than choosing a Viewer: the repo is built here and the agent cannot widen
    it."""
    rt = wire(app, projects=[Project(name="R", city="C", commission="4%")])
    with TestClient(app) as client:
        client.post(
            "/chat",
            json={"question": "hi", "mode": "client"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    from app.adapters.projects_redacting import RedactingProjectRepo

    assert isinstance(rt.seen["repo"], RedactingProjectRepo)
    assert rt.seen["mode"] is ChatMode.CLIENT


def test_an_unconfigured_model_says_so_rather_than_500ing(app):
    wire(app)
    app.state.container.runtime = None
    with TestClient(app) as client:
        r = client.post("/chat", json={"question": "hi"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert sse(r.text)[0]["type"] == "error"


def test_an_unconfigured_repo_streams_an_error_rather_than_500ing(app):
    """The same class of misconfiguration as a missing runtime, so the client
    must see the same shape -- not an HTML 500 where it expected an event
    stream."""
    wire(app)
    app.state.container.projects = None
    with TestClient(app) as client:
        r = client.post("/chat", json={"question": "hi"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert sse(r.text)[0]["type"] == "error"


def test_a_runtime_that_raises_still_ends_in_an_error_event(app):
    """The port promises an iterator of events, not that it never raises."""

    class Exploding(StubRuntime):
        async def stream(self, **kw):
            yield {"type": "text", "text": "partial"}
            raise RuntimeError("upstream died")

    wire(app, runtime=Exploding())
    with TestClient(app) as client:
        r = client.post("/chat", json={"question": "hi"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert [e["type"] for e in sse(r.text)][-1] == "error"


def test_an_empty_question_is_refused(app):
    wire(app)
    with TestClient(app) as client:
        r = client.post("/chat", json={"question": ""}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 422


def test_a_very_long_question_is_refused(app):
    wire(app)
    with TestClient(app) as client:
        r = client.post(
            "/chat", json={"question": "x" * 5000}, headers={"Authorization": f"Bearer {TOKEN}"}
        )
    assert r.status_code == 422


def test_history_is_passed_through_to_the_runtime(app):
    rt = wire(app)
    with TestClient(app) as client:
        client.post(
            "/chat",
            json={
                "question": "only detached",
                "history": [
                    {"role": "user", "content": "projects in Brampton"},
                    {"role": "assistant", "content": "Here are 11."},
                ],
            },
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    assert [t.content for t in rt.seen["history"]] == ["projects in Brampton", "Here are 11."]


def test_an_overlong_history_is_refused(app):
    """A cap, so the prompt cannot grow without bound one refinement at a time."""
    wire(app)
    turns = [{"role": "user", "content": "x"}] * 50
    with TestClient(app) as client:
        r = client.post(
            "/chat",
            json={"question": "hi", "history": turns},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    assert r.status_code == 422
