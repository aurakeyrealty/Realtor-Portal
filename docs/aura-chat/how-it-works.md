# Aura Chat, end to end

A walkthrough for someone who has never seen this code. It starts with an empty
process and finishes with an answer on a realtor's screen, in that order, and
tries never to use a term it has not already explained.

Read it straight through — everything is in the order it happens. Or jump:

| | |
|---|---|
| [Part I](#part-i--the-process-starts) | what happens when the process starts |
| [Part II](#part-ii--the-map) | every file, every function that matters |
| [Part III](#part-iii--a-request-arrives) | how a request is authenticated |
| [Part IV](#part-iv--one-chat-interaction-step-by-step) | **one chat interaction, step by step** |
| [Part V](#part-v--the-other-flows) | `/health`, `/doctor`, `/login`, `/me`, and the portal side |
| [Part VI](#part-vi--the-cli-traced) | the CLI, traced |
| [Part VII](#part-vii--how-this-is-tested) | how this is tested |
| [Part VIII](#part-viii--when-something-breaks) | when something breaks |
| [Part IX](#part-ix--the-rules-that-hold-it-together) | the four ideas behind most of the code |
| [Part X](#part-x--what-is-not-built-yet) | what is not built yet |

If you only read one part, read **IV**. If you are debugging, start at **VIII**.

Companion documents: [architecture.md](architecture.md) is *why* this shape was
chosen and what was rejected; [invariants.md](invariants.md) is the rules that
break security or cost an afternoon; [../worklog.md](../worklog.md) is why each
change was made, newest first.

---

## 0. What this is, in one paragraph

Aura Key Realty is a Toronto-area brokerage with about twenty realtors. They
already have a portal — a Google Apps Script web app reading Google Sheets,
plus an installable phone app. Aura Chat adds one thing: a realtor can *ask*
instead of browsing. *"Show me detached homes under $1M in Brampton."*

It is a **separate Python service**. It stores no project data of its own, holds
no Google credential, and has no privilege a realtor does not. It reads the
brokerage's data through the portal's own API, using the realtor's own login.

```mermaid
flowchart LR
    R["Realtor"] -->|question| A["Aura Chat<br/>Python / FastAPI"]
    A -->|"the realtor's own token"| P["The portal<br/>Apps Script"]
    P --> S[("Google Sheets<br/>~38 city tabs")]
    A <-->|"prompt + tool calls"| M["OpenRouter<br/>→ a language model"]
    A -->|"answer + project cards"| R
```

Two sentences worth holding on to, because most of the design follows from them:

1. **Aura Chat borrows the realtor's identity.** It never has its own.
2. **The model never sees anything a tool did not hand it**, and never decides
   what a realtor may see.

---

## Part I — The process starts

### 1.1 The entry point

```bash
uvicorn app.main:app
```

`uvicorn` is the web server. `app.main:app` means *import `app/main.py`, find the
object called `app`*. That object is a FastAPI application.

`app/main.py` is 38 lines and does three things.

```python
def create_app() -> FastAPI:
    app = FastAPI(title="Aura Chat", version="0.1.0", lifespan=lifespan)
    app.include_router(router)        # /login /health /doctor /me
    app.include_router(chat_router)   # /chat
    return app

app = create_app()
```

**A router** is a group of URL handlers. There are two — the ordinary endpoints
in `app/api.py`, and the chat endpoint in `app/chat.py`, kept apart because chat
is the only one that streams.

**`lifespan`** is a hook FastAPI calls once on startup and once on shutdown.
It is one function holding both, split by a `yield`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    ...        # startup: runs once, before the first request
    yield      # the server serves requests here, for hours
    ...        # shutdown: runs once, as the process exits
```

If you have seen `@app.on_event("startup")` and `@app.on_event("shutdown")`,
this replaced them. A context manager keeps the setup and its teardown side by
side rather than in two functions that have to remember to agree.

Why the assembly cannot simply happen at import time: `build()` reads `.env` and
opens an `httpx.AsyncClient`, which wants a running event loop. Startup is the
first moment there is one. This is where the application assembles itself:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    owned = getattr(app.state, "container", None) is None
    if owned:
        app.state.container = container_mod.build()
    try:
        yield                          # ← the server runs here
    finally:
        if owned:
            await app.state.container.aclose()
```

The `owned` check exists because of a real bug. Tests inject a container full of
fakes *before* starting the app; the original version built over it, silently
replacing the fakes with real adapters reading a `.env` file that does not exist
in CI. Now startup only builds what nobody supplied, and only closes what it
built.

### 1.2 The container

**Not a Docker container.** The word is older than Docker in this sense and the
collision is unfortunate. This container is just a box holding the objects that
live as long as the process does — a dataclass with six fields.

The problem it solves: something has to decide *which* `ProjectRepo` this process
uses. If every module that needed one constructed
`ExecApiProjectRepo(PortalClient(url))` for itself, then swapping to Postgres
later would mean editing twenty files, the process would hold twenty HTTP
connection pools instead of one, and a test could not substitute a fake without
monkeypatching. So one file constructs everything and every other file is
*handed* what it needs.

That file is the **composition root**, and the box it returns is the container.
Other ecosystems reach for a DI framework here — Spring, .NET's container. For
five objects, 59 lines and no library is the right size.

`container_mod.build()` — `app/container.py`, 59 lines — is that root: the one
place in the entire service where a concrete implementation is chosen.

```mermaid
flowchart TD
    B["build()"] --> C["config.load()<br/>reads .env and the environment"]
    C --> P["PortalClient(exec_url)"]
    P --> A["PortalHmacAuthVerifier(secret, portal)"]
    P --> R["ExecApiProjectRepo(portal)"]
    C --> G["PydanticAgentRuntime(api_key, model, max_tokens)"]
    A --> K["Container"]
    R --> K
    G --> K
    P --> K
    K --> S["app.state.container"]
```

The `Container` is a plain dataclass holding those objects:

| Field | What it is | Built in |
|---|---|---|
| `settings` | every configuration value | Phase 1 |
| `portal` | HTTP client for the Apps Script API | Phase 1 |
| `auth` | verifies session tokens | Phase 1 |
| `projects` | reads project records | Phase 2 |
| `runtime` | runs the model loop | Phase 3 |
| `store` | conversation history | **not built yet** |
| `documents` | PDF retrieval | **not built yet** |

The unbuilt ones are `None`, and every reader checks. `/doctor` reports them as
`"not wired yet"` rather than as failures.

**How a request reaches it.** Three hops, all boring:

```
app.state.container            # set once, at startup
  → container(request)         # api.py:13 -- returns request.app.state.container
    → c.projects_for(viewer)   # builds the per-request redacting repo
```

One long-lived box, and one short-lived wrapper built per request out of it.
That split is the shape of the whole service: connection pools and caches live
for the process, redaction lives for the request.

**Why one file matters.** Everything above the adapter layer depends on an
*interface*, never on an implementation. Moving project data from Sheets to a
database means writing a second adapter and adding one branch here. Nothing else
changes — not the tools, not the prompt, not the API. `tests/test_layering.py`
enforces this by walking the imports of every file: anything outside
`container.py` importing `app.adapters` fails the suite.

**Watch it work.** Suppose project data moves from Sheets to Postgres.

Today, the class name appears once:

```python
# container.py -- the ONE place a concrete class is named
projects = ExecApiProjectRepo(portal)
```

The route handler touches the container, but never names a class:

```python
# chat.py -- the door
c = container(request)
repo = c.projects_for(viewer)      # receives an object
async for event in c.runtime.stream(..., repo=repo, ...):
```

And the layer below receives the object as an argument:

```python
# tools.py -- has never heard of the container, or of Sheets
async def search_projects(repo: ProjectRepo, *, auth: str, city: str = "", ...):
    return await repo.search(ProjectFilters(city=city, ...), auth=auth)
```

The swap is then one line:

```python
projects = (
    PostgresProjectRepo(dsn) if cfg.project_source == "postgres"
    else ExecApiProjectRepo(portal)
)
```

`tools.py` unchanged, `agent_pydantic.py` unchanged, the prompt unchanged, the
API unchanged — because none of them ever wrote `ExecApiProjectRepo`. The payoff
is not tidiness. It is the size of the diff when the data source moves.

**The container is touched only at the door.** This is the part worth being
precise about, because it is not the same as a *service locator*, where any
function reaches into a global box and pulls out what it needs:

```python
async def search_projects(city=""):
    repo = get_container().projects        # <- NOT how this works
```

Two things go wrong with that. A test can no longer hand in a fake without
patching a global. And — the one that matters — `container.projects` is the
**unredacted** repo. The entire Client Mode guarantee rests on a tool being
*handed* the redacting wrapper and having no way to ask for anything else.

So: the container assembles objects once, the route handler opens it once, and
everything past that point receives its dependencies as parameters and cannot
see what is inside them.

### 1.3 Configuration

`app/config.py` is the only module that reads the environment. Everything else
receives values.

```python
class Settings(BaseSettings):
    token_secret: str = ""        # MUST match the portal's Script Property
    exec_url: str = ""            # the deployed Apps Script web app
    openrouter_api_key: str = ""
    llm_model: str = "google/gemini-2.5-flash"
    llm_max_tokens: int = 1500
    project_source: str = "exec"  # which ProjectRepo to build
```

Two of these have caused real outages:

- **`token_secret`** must be byte-identical to the portal's. A mismatch means
  every realtor gets 401 while `/health` stays green — which is why `/doctor`
  exists and why it works without a valid token.
- **`llm_max_tokens`** defaults to 1500 because, unset, providers advertise their
  entire context window (65,535 for Gemini Flash) and OpenRouter reserves credit
  against that number *before* the call. Every request was refused 402 until this
  was capped.

At this point the process is listening and nothing else has happened.

---

## Part II — The map

Before following a request, here is every file and why it exists. The service is
deliberately organised in four layers, and the direction of dependency never
reverses.

```mermaid
flowchart TD
    subgraph HTTP["HTTP surface"]
        API["api.py<br/>/login /health /doctor /me"]
        CHAT["chat.py<br/>/chat, streams events"]
        MAIN["main.py<br/>startup"]
    end
    subgraph CORE["Core — knows nothing about the outside world"]
        TOOLS["tools.py<br/>what the model may do"]
        DOM["domain/<br/>Project, Viewer, Claims, Turn"]
        PORTS["ports/<br/>five Protocols"]
        PROMPT["prompts.py"]
    end
    subgraph ADAPT["Adapters — one per port"]
        PC["portal_client.py"]
        PE["projects_exec.py"]
        PR["projects_redacting.py"]
        AUTH["auth_portal_hmac.py"]
        AG["agent_pydantic.py"]
        PARSE["parsing.py"]
    end
    CONT["container.py — the ONLY file that builds an adapter"]

    HTTP --> CONT
    HTTP --> CORE
    TOOLS --> PORTS
    TOOLS --> DOM
    PORTS --> DOM
    CONT --> ADAPT
    ADAPT --> PORTS
    ADAPT --> DOM
```

### `app/domain/` — what the business means

Pure data. Imports nothing external: not FastAPI, not the agent framework, not
the HTTP client. If a vendor type appeared here it would leak into every layer
above and pin them to today's stack.

| File | Holds |
|---|---|
| `project.py` | `Project` — one project as the *business* means it, not as a sheet stores it. `ProjectFilters` — a search expressed as intent. |
| `identity.py` | `Claims` (who is asking), `Role` (realtor \| admin), `ChatMode` (realtor \| client) |
| `viewer.py` | `Viewer` — role × mode, and the single source of truth for what each audience may see |
| `matching.py` | `matches(project, filters)` and `sort_key(project)` — the filter rules, pure and testable |
| `conversation.py` | `Turn` — one `{role, content}` exchange |

`Project` is the crux of the whole design. It has `starting_price: int | None`,
not `"STARTING PRICE"`. Every adapter maps its own storage into this shape, so
nothing above the adapter layer ever learns a tab name, a row number, or a
column header.

### `app/ports/` — the five seams

A **port** is a `Protocol`: a description of what something must be able to do,
with no implementation. Five, capped deliberately.

| Port | Method surface | Adapter today | Plausible replacement |
|---|---|---|---|
| `ProjectRepo` | `search` `get` `recent` `refresh` `healthy` | Apps Script API | Postgres, a CRM |
| `AuthVerifier` | `verify_local` `verify` | portal HMAC token | OAuth / SSO |
| `AgentRuntime` | `stream` `healthy` | PydanticAI | LangGraph, a hand-rolled loop |
| `ConversationStore` | `create` `append` `history` `list_for` | *not built* | Postgres |
| `DocumentIndex` | `query` `healthy` | *not built* | pgvector |

Deliberately **not** ports: the HTTP framework, the database driver, and the
model provider. Swapping OpenRouter for Gemini directly is already a model
string; a port there would wrap an abstraction that exists.

The last two ports are declared before their adapters exist so tools and tests
can be written against them. `tests/fakes.py` has an in-memory implementation of
each, which is why the whole suite runs with no network.

### `app/adapters/` — one implementation per port

| File | Role |
|---|---|
| `portal_client.py` | HTTP to the Apps Script API. POSTs, follows redirects, refuses non-JSON. |
| `projects_exec.py` | `ProjectRepo` over that client. **The only file that knows a sheet column exists.** |
| `projects_redacting.py` | A `ProjectRepo` that wraps another and can only return what its `Viewer` may see. |
| `auth_portal_hmac.py` | Verifies the portal's token signature; asks the portal about liveness. |
| `agent_pydantic.py` | `AgentRuntime`. **The only file that imports an agent framework.** |
| `parsing.py` | `"$899,900"` → `899900`. Pure, and the messiest code in the service. |

### The rest

- **`app/tools.py`** — the four things the model may do. Plain async functions
  over ports. No framework import, no adapter import.
- **`app/prompts.py`** — the system prompt. Rules the model is *asked* to follow.
- **`app/diagnostics.py`** — the checks behind `/health` and `/doctor`.
- **`app/cli.py`** — `aura`, a terminal client. Talks HTTP like any other client.

### Every file, every function that matters

If you are looking for where something happens, this is the index.

**`app/main.py`** (38) — `lifespan()` builds the container unless one was
injected · `create_app()` mounts both routers

**`app/container.py`** (59) — `build()` constructs every adapter, the only place
that does · `Container.projects_for(viewer)` returns a repo narrowed to one
audience · `Container.aclose()` closes the HTTP client

**`app/config.py`** (50) — `Settings` every value · `auth_ready` / `portal_ready`
what `/health` reports · `load()`

**`app/api.py`** (144) — `container(request)` reaches the container ·
`_bearer()` parses the header · `presented_token()` a token was sent ·
`current_claims()` a token that verifies, else 401 · `login()` `health()`
`doctor()` `me()`

**`app/chat.py`** (92) — `Ask` the request body and its limits · `_sse()` formats
one event · `chat()` opens the stream · `events()` the generator, where every
failure is caught so it reaches the client in the shape it is reading

**`app/tools.py`** (110) — `search_projects()` `get_project()`
`compare_projects()` `get_recent_projects()` · `MAX_RESULTS = 12`,
`MAX_COMPARE = 4`. `get_project` resolves an id *or* an exact unique name, and
returns `None` on ambiguity rather than guessing between two projects that share
a name.

**`app/prompts.py`** (93) — `SYSTEM` the rules · `CLIENT_MODE_NOTE` appended in
Client Mode · `system_prompt(client_mode=)`

**`app/diagnostics.py`** (231) — `Check` / `Report` one result and the whole ·
`shallow()` what `/health` runs · `deep()` what `/doctor` runs · `_timed()` runs
a check and times it, turning any exception into a failed check rather than a
500 · `_token_check()` the pairing that separates a wrong key from a stale
token · `_redact()` for unverified callers · `data_quality()`

**`app/domain/project.py`** (118) — `Project` · `for_viewer(viewer)` a copy
carrying only what that audience may see · `is_ai_ready` · `ProjectFilters` ·
`CONFIDENTIAL_FIELDS`

**`app/domain/viewer.py`** (69) — `Viewer.of(claims, mode)` ·
`Viewer.hidden_fields` the union · `ADMIN_ONLY` · `CLIENT_HIDDEN` · `STRICTEST`

**`app/domain/matching.py`** (62) — `matches(project, filters)` every filter
rule · `sort_key(project)` focus first, then cheapest known price, unpriced last

**`app/domain/identity.py`** (31) — `Claims` · `Role` · `ChatMode`

**`app/domain/conversation.py`** (30) — `Turn` · `MAX_HISTORY_TURNS = 20`

**`app/adapters/portal_client.py`** (111) — `call(action, auth=, timeout_s=)` one
POST to the dispatcher · `healthy()` cached 60s on success, 5s on failure ·
`aclose()` · `PortalError`

**`app/adapters/projects_exec.py`** (187) — `search()` `get()` `recent()`
`refresh()` · `_index(auth, fresh=)` the five-minute cache · **`_to_project(raw)`
the containment boundary — the only function in the service that knows a sheet
column exists**

**`app/adapters/projects_redacting.py`** (55) — wraps another `ProjectRepo`;
every read passes through `_redact()`. Also re-exposes `total_rows` and
`unparsed_prices` so diagnostics survives the wrapper.

**`app/adapters/auth_portal_hmac.py`** (132) — `verify_local()` signature and
window, no network · `verify()` adds liveness via the portal, cached 60s ·
`_prune()` evicts expired entries and caps the cache

**`app/adapters/parsing.py`** (167) — `is_blank()` `parse_money()`
`parse_price_range()` `parse_percent()` `parse_min_bedrooms()` `parse_date()`
`slugify()`

**`app/adapters/agent_pydantic.py`** (344) — `build_agent()` registers the four
tools · `_agent_for(client_mode)` memoised, two at most · `_model_for()`
memoised · `_as_messages(history)` our `Turn`s into framework messages ·
`_for_model(project)` what the model sees, empty fields dropped · `_keep()`
collects and dedupes · `stream()` the queue, the background task, the cancel ·
`MAX_STEPS = 6`

**`app/cli.py`** (384) — traced in Part VI.

---

## Part III — A request arrives

Every endpoint except `/health` and `/login` needs a verified identity. That
happens in `app/api.py` before the handler runs.

### 3.1 The token

The portal issues a signed, self-contained token. Aura Chat did not invent it and
does not mint it — the realtor's phone already holds one.

```
raw   = username | role | credentialFingerprint | issuedAtMillis
token = base64url(raw) + "." + base64url(HMAC-SHA256(raw, TOKEN_SECRET))
```

### 3.2 Two levels of verification, and why

`app/adapters/auth_portal_hmac.py` has two methods because Python can check some
things and not others.

```mermaid
flowchart TD
    T["Bearer token"] --> L["verify_local()<br/>no network"]
    L --> S{"signature valid?"}
    S -->|no| X["401"]
    S -->|yes| W{"within 7 days?"}
    W -->|no| X
    W -->|yes| CA{"seen in the last 60s?"}
    CA -->|yes| OK["Claims"]
    CA -->|no| PORTAL["ask the portal:<br/>session action"]
    PORTAL --> R{"reply"}
    R -->|"ok: true"| OK
    R -->|"ok: false"| X
    R -->|unreachable| OK2["Claims<br/>(honour it — see below)"]
```

`verify_local` checks the HMAC signature and the seven-day window. It needs no
network, so junk is rejected without a round trip.

It **cannot** check two things, both of which require the LOGIN sheet: the
credential fingerprint (which is what makes a password change revoke old
sessions) and whether the account still exists. So `verify` delegates those to
the portal's own `session` action, cached 60 seconds.

**The unreachable branch is deliberate.** If the portal is *unwell* rather than
*refusing*, a locally valid token is honoured. Refusing would sign out the entire
team during an Apps Script outage — a worse failure than briefly honouring a
token that may have just been revoked.

Three details in `verify_local` that look arbitrary and are not:

- **Fields are parsed from the *end*.** A username may contain `|`, so counting
  from the front misreads every field after it. This was a real production bug
  (commit `61b06fc`) and is now a test.
- **`hmac.compare_digest`**, not `==`. A byte-wise comparison leaks the signature
  one character at a time to anyone willing to measure.
- **No secret means no sessions.** There is no permissive default anywhere.

### 3.3 Two dependencies, on purpose

```python
async def current_claims(...) -> Claims:   # requires a VALID token → 401 if not
async def presented_token(...) -> str:     # requires only that one was SENT
```

`/chat` and `/me` use the first. `/doctor` uses the second — because when
`TOKEN_SECRET` is wrong *nothing* verifies, and that is precisely the moment
somebody needs a diagnosis. A doctor that stops working when the patient is sick
is no use.

---

## Part IV — One chat interaction, step by step

This is the main story. A realtor types **"show me townhomes in Brampton"** and
presses send.

```mermaid
sequenceDiagram
    autonumber
    participant U as Realtor
    participant C as chat.py
    participant V as auth verifier
    participant K as container
    participant RT as agent_pydantic
    participant M as model (OpenRouter)
    participant T as tools.py
    participant RD as RedactingProjectRepo
    participant EX as ExecApiProjectRepo
    participant P as portal → Sheets

    U->>C: POST /chat  {question, mode, history}
    C->>V: verify(token)
    V-->>C: Claims(user, role)
    C->>C: Viewer.of(claims, mode)
    C->>K: projects_for(viewer)
    K-->>C: RedactingProjectRepo
    C-->>U: data: {"type":"start","mode":"realtor"}
    C->>RT: stream(question, repo, mode, history)
    RT->>M: system prompt + question + tool definitions
    M-->>RT: call search_projects(city="BRAMPTON", categories=["townhome"])
    RT-->>U: data: {"type":"tool", ...}
    RT->>T: search_projects(repo, ...)
    T->>RD: search(ProjectFilters)
    RD->>EX: search(ProjectFilters)
    alt index cached (< 5 min)
        EX-->>RD: 246 Projects from memory
    else cold
        EX->>P: POST {action:"aiindex", auth}
        P-->>EX: 246 raw rows
        EX->>EX: _to_project() on each
    end
    RD->>RD: for_viewer() on every result
    RD-->>T: redacted Projects
    T-->>RT: capped at 12
    RT-->>U: data: {"type":"tool_result","count":11}
    RT->>M: tool results
    M-->>RT: text, token by token
    RT-->>U: data: {"type":"text", ...} × many
    RT-->>U: data: {"type":"projects", ...}
    RT-->>U: data: {"type":"done","usage":{...}}
```

Now the same thing in words.

### Step 1 — The request is validated

```python
class Ask(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    mode: ChatMode = ChatMode.REALTOR
    conversation_id: str | None = None
    history: list[Turn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)
```

FastAPI rejects an empty question, a 5,000-character question, or a 50-turn
history with a 422 before any handler runs.

### Step 2 — Identity, then audience

```python
claims = await current_claims(...)      # who the account is
viewer = Viewer.of(claims, body.mode)   # what this screen may show
repo = c.projects_for(viewer)
```

**The client sends `mode`, and nothing downstream trusts it with more than
this.** It picks a `Viewer`; the repo built from that `Viewer` is the only route
the agent has to project data. A compromised client can choose to see *less*,
never more.

`Viewer` unions two independent axes:

```mermaid
flowchart TD
    V["Viewer(role, mode)"] --> RQ{"role is admin?"}
    RQ -->|no| A["hide ADMIN_ONLY<br/>builder_login"]
    RQ -->|yes| N1["hide nothing on this axis"]
    V --> MQ{"mode is client?"}
    MQ -->|yes| B["hide CLIENT_HIDDEN<br/>commission, internal_notes,<br/>builder_office, builder_contact,<br/>fub_template, broker_url, status"]
    MQ -->|no| N2["hide nothing on this axis"]
    A --> U["union"]
    N1 --> U
    B --> U
    N2 --> U
```

| role | mode | hides |
|---|---|---|
| realtor | realtor | `builder_login` |
| realtor | client | all 8 |
| admin | realtor | *nothing* |
| admin | client | all 8 |

Union, never intersection: an admin in Client Mode is still showing a buyer a
screen, so entitlement never buys back a client-hidden field.

### Step 3 — The stream opens

`/chat` returns a `StreamingResponse` of **Server-Sent Events**: a long-lived
HTTP response where the server writes `data: {...}` lines as things happen. It is
why the realtor sees words appearing rather than five seconds of spinner, and it
is one of the reasons this service does not live inside Apps Script, which cannot
stream at all.

The first event is always:

```
data: {"type": "start", "mode": "realtor"}
```

The mode is echoed **before any content** so the interface can prove which mode
it is in. A realtor must never wonder whether the screen they just turned toward
a buyer is safe.

### Step 4 — The agent runs

`PydanticAgentRuntime.stream()` in `agent_pydantic.py` is the most intricate
function in the service. Two coroutines share one queue.

```mermaid
flowchart LR
    subgraph BG["background task: run()"]
        RS["agent.run_stream()"] --> OE["on_event handler<br/>tool calls, tool results"]
        RS --> TX["stream_text(delta=True)"]
    end
    OE -->|put_nowait| Q(("asyncio.Queue"))
    TX -->|put_nowait| Q
    Q -->|await get| CONS["the generator<br/>yields to /chat"]
    CONS --> SSE["data: {...}"]
```

**Why a queue and not a list.** The first version collected events into a list
and drained it inside the text loop. But `stream_text` yields nothing until the
model has finished calling tools — so the buffer could only flush *after* the
work it described. Measured live: everything arrived together at 4,300ms. With
the queue:

```
  1491ms  start
  2252ms  tool         search_projects     ← "searching…" appears here
  3575ms  tool_result  search_projects
  4300ms  text                             ← previously ALL of it landed here
  4915ms  done
```

Two seconds of visible progress where there had been a blank spinner.

The consumer cancels the background task in a `finally`. Before that, a realtor
closing the app mid-answer left the run going — and billing — with nobody
reading it.

### Step 5 — The model decides

The agent is built once per mode and reused. Constructing it per request created
a fresh OpenAI client and connection pool every time, none of them ever closed.

It is given:

- **The system prompt** (`prompts.py`), whose first rule is: never state a price,
  deposit, incentive, occupancy or bedroom count that did not come back from a
  tool in this conversation.
- **Four tool definitions**, generated from the Python signatures.
- **The conversation so far**, converted from `Turn` objects. Text only —
  replaying an old tool result would put a price the sheet has since changed back
  into the prompt, with no way for the model to know it was stale.
- **A hard cap of 6 model round trips** (`MAX_STEPS`). The framework's own
  default is 50, which is not a limit anyone chose.

The model replies with a tool call: `search_projects(city="BRAMPTON",
categories=["townhome"])`.

### Step 6 — The tool runs

Four layers, each of which knows less than the one below it.

```mermaid
flowchart TD
    A["agent_pydantic.search_projects<br/>the framework's tool wrapper"] --> B["tools.search_projects<br/>builds ProjectFilters, caps at 12"]
    B --> C["RedactingProjectRepo.search<br/>filters first, then redacts"]
    C --> D["ExecApiProjectRepo.search<br/>matches() + sort_key() over the cached index"]
    D --> E["PortalClient.call('aiindex')"]
    E --> F["Apps Script app() → getAiIndex_()"]
    F --> G[("Google Sheets")]
```

Three things happen here that are easy to miss:

**Filtering runs on unredacted records.** Think of `RedactingProjectRepo` as a
clerk standing in front of a filing cabinet. The model never opens the cabinet
itself. It asks the clerk for "detached homes under $1M in Brampton with
commission over 4%"; the clerk reads the *full* sheets — commission included,
which is how it matched at all — pulls the ones that fit, then photocopies them
with the commission blacked out and hands over the copies. The model answers
from the copies, so the number never reaches the prompt and cannot be read
aloud to the buyer standing beside the phone. Alone in Realtor Mode, the same
clerk blacks out nothing and hands over the originals.

Concretely: `RedactingProjectRepo` asks the inner repo to filter, then redacts
the results. A search may legitimately *use* a field
it must not *show* — redacting first would silently change which projects come
back depending on who is looking, which is worse than showing too little because
it is invisible.

**The index is one payload, cached five minutes.** Aura Chat fetches all ~246
projects and filters in Python, rather than asking the portal to filter. Apps
Script runtime is a single daily budget shared with the realtors' own app, so a
busy conversation costs one fetch per five-minute window instead of one per
question.

**The cache is one slot for the whole process.** Correct today only because
`aiindex` returns identical bytes to every signed-in realtor. If it ever varies
by role, this must be keyed on the same axis — the portal already faces this in
`getBuilders_`, which keeps separate cache keys so an admin's payload can never
reach a realtor. Recorded as invariant #9.

### Step 7 — A sheet row becomes a Project

`ExecApiProjectRepo._to_project()` is the containment boundary. Everything a
sheet knows stops here.

```mermaid
flowchart LR
    A["sheet cell<br/>'$899,900'"] --> B["aiindex row<br/>{price: '$899,900'}"]
    B --> C["parse_money()"]
    C --> D["Project.starting_price<br/>899900"]
    D --> E["for_viewer()"]
    E --> F["_for_model()<br/>{starting_price: 899900}"]
    F --> G["the prompt"]
    D --> H["the project card"]
```

The parsers in `parsing.py` follow one rule: **never guess.**

| input | result | why |
|---|---|---|
| `"$899,900"` | `899900` | |
| `"From $899,900"` | `899900` | prefixes are noise |
| `"$1.2M"` | `1200000` | |
| `"$800,000 - $1,400,000"` | low `800000`, high `1400000` | both ends kept |
| `"1.2"` | `None` | $1.20 or $1.2M? Refuse rather than guess |
| `"TBD"` | `None` | not filled in — different from unreadable |
| `"10%"` | `10.0` | |
| `"0.1"` | `10.0` | a percent-formatted cell shown as a fraction |
| `"1%"` | `1.0` | the `%` already said what it is |

And in `matching.py`: **an unpriced project never satisfies a price filter.** It
is *unknown*, not cheap. Letting it through is how an answer ends up asserting
something the sheet never said.

### Step 8 — Results come back

`tools.py` caps at 12 results and 4 comparisons. One question must never drag the
whole sheet into a prompt.

`agent_pydantic._for_model()` converts each `Project` to a dict for the model,
**dropping empty fields entirely**. A page of `""` teaches a model that missing
data is normal and invites it to fill the gaps; what is absent should be absent.

Each project is also kept in `Deps.collected`, deduplicated by id — including
duplicates *within* one result set, because two rows can share a `PROJECT ID`
while the column is being entered by hand.

### Step 9 — The answer streams

The model writes prose. Each delta becomes a `text` event.

Then two closing events:

```
data: {"type":"projects","projects":[ ... ]}
data: {"type":"done","usage":{"requests":2,"input_tokens":1957,"output_tokens":41}}
```

**The cards are built from `Deps.collected` — the tool results — never parsed out
of the model's prose.** If the model says *"around $1.2M"* about an $899,900
project, the card still says $899,900. Restating numbers is how they drift
between the sheet and the buyer.

### Step 10 — The client renders

The CLI (`app/cli.py`) prints text as it arrives and the cards at the end. In
`--dev` it shows each tool call with its arguments, timings and token usage —
which answers *"was this a data, a retrieval, or a model problem?"* in one
screen.

The PWA chat screen is **not built yet**. That is the next piece of work.

---

## Part V — The other flows

### `GET /health` — for the platform

Public, cheap, deliberately uninformative: `{"status": "ok", "ok": true}`. It
says whether we are serving, not which secret is missing — a stranger learning
that `TOKEN_SECRET` is unset is a stranger learning when to try forging one.

The portal probe underneath is cached (60s on success, 5s on failure) because
an uptime monitor polling every 30 seconds would otherwise spend ~2,900 Apps
Script executions a day out of a budget the realtors' own app shares.

### `GET /doctor` — for a human

Requires that a token was *sent*, not that it verifies. Runs every check that
needs one, and says which failed:

| # | check | proves | critical |
|---|---|---|---|
| 1 | `config` | which settings are missing, by name | yes |
| 2 | `portal_reachable` | the deployment answers at all | yes |
| 3 | `model` | the runtime is wired | yes |
| 4 | `portal_auth` | the portal accepts **this** token | yes |
| 5 | `token_verification` | our `TOKEN_SECRET` matches the portal's | yes |
| 6 | `project_data` | **Aura can actually read projects** | yes |
| 7 | `conversation_store` | Phase 4 — currently `not wired yet` | no |
| 8 | `document_index` | Phase 5 — currently `not wired yet` | no |
| 9 | `data_quality` | how many projects, how many unreadable prices | no |

Checks 4 and 5 are a pair, and the pairing is the point. **A wrong
`TOKEN_SECRET` and an expired session look identical from the outside** — every
realtor gets 401 while `/health` stays green. Reading the portal's verdict
against our own separates them:

```mermaid
flowchart TD
    A["portal_auth"] --> B{"portal accepted it?"}
    B -->|yes| C{"did we verify it?"}
    B -->|no| D["the token is stale or revoked<br/>→ sign in again"]
    C -->|yes| E["all well"]
    C -->|no| F["the portal knows this token and we do not:<br/>TOKEN_SECRET does not match"]
```

That last branch is the one nobody diagnoses quickly without help, which is the
whole reason `/doctor` accepts a token that does not verify.

For an unverified caller the report still runs, but detail is **redacted**
everywhere except `token_verification` and `portal_auth` — they are the
diagnosis, and neither tells a stranger anything usable.

Severity is graded. A missing conversation store makes the report `degraded`; a
failing `project_data` makes it `down`. So a platform restart policy fires on a
real outage and not on Postgres hiccuping.

`?fresh=1` rebuilds both caches — ours and the portal's. It walks all 38 tabs
and takes about a minute, so it carries its own 240-second timeout; the ordinary
30-second read budget cut it off part-way and reported it as "portal
unreachable", which points at the network rather than at the clock.

### `GET /me`

Two lines, and it earns them: `{user, role, admin}` for a verified token, 401
otherwise. It proves the whole auth path end to end without touching project
data, which makes it the first thing to try when `/chat` misbehaves and you want
to know whether the problem is authentication at all.

### `POST /login`

A pass-through to the portal, which owns the LOGIN sheet, the password hashing
and the rate limiting. Nothing is stored or logged here — the password exists for
the length of one outbound request, and what comes back is the token.

It passes the portal's own wording through, because *"too many attempts — try
again in a few minutes"* and *"invalid id or password"* mean different things to
whoever is trying to get in.

### The portal side

Aura Chat added exactly one thing to the Apps Script project: `Ai.js`, holding
`getAiIndex_()` and the `aiindex` action. Read-only, composing readers that
already existed, in its own file so the whole surface can be deleted in one move.

`FIELD_KEYS` in `Core.js` gained ten commercial columns. Additive: an unmapped
column reads as empty, so the 37 tabs that do not carry them behave exactly as
before.

One trap is commented there. `buildColMap_` binds each field to the **first**
header containing its keyword, so `PRICE` would have matched ONTARIO's
`PRICE RANGE` — the keyword is the whole `STARTING PRICE`. And a `PROJECT ID`
column added at column A rather than the right-hand end would both make every
project render as an id *and* stop `getCities_` recognising the tab at all.

---

## Part VI — The CLI, traced

`aura` is the only working client today, and it is a useful thing to trace
because it uses the service exactly as the phone app will.

### Signing in

```mermaid
sequenceDiagram
    autonumber
    participant U as You
    participant CLI as cli.py
    participant API as api.py /login
    participant P as portal
    participant F as ~/.aura/session.json

    U->>CLI: aura login
    CLI->>U: Portal ID:
    CLI->>U: Password: (getpass, not echoed)
    CLI->>API: POST /login {user, password}
    API->>P: POST {action:"login", user, password}
    P->>P: hash, compare, rate-limit
    P-->>API: {ok:true, token, name}
    API-->>CLI: {token, name, role}
    CLI->>F: write {token, name}, chmod 0600
    CLI->>U: signed in as Demo
```

The password is typed by the person at the keyboard, travels once, and is
written nowhere. What is stored is the token — a bearer credential, so `0600` is
the least the file deserves.

Token precedence when asking: `--token` → `$AURA_TOKEN` → the session file. If
none of the three yields anything, the CLI says `not signed in — run aura login`
rather than sending an empty header and reporting a 401.

### Asking

`ask()` opens the SSE stream and hands each event to `_render()`, which behaves
differently in three modes:

| mode | text | tool events | errors |
|---|---|---|---|
| normal | printed as it streams | hidden | stdout |
| `--dev` | held, printed whole at the end under the trace | shown with args and timings | stdout |
| `--json` | **suppressed** | hidden | **stderr** |

`--json` suppresses the live echo because anything printed before the object
makes the output unparseable — which is the one thing that flag exists for.
Errors go to stderr for the same reason.

### Holding a conversation

The REPL keeps `history` as a list of `{role, content}` and sends it with each
question, trimmed to the same 20-turn cap the server enforces so a long session
cannot start failing validation.

**A turn that produced no answer is not recorded.** `ask()` returns an empty
answer when the stream carried an `error` event, and an empty assistant message
is rejected outright by some providers — one failure would poison every question
after it. Both halves of the turn are dropped, because keeping the user half
alone leaves two consecutive user messages, which fails the same way.

`/new` clears it, `/mode` switches audience, `/dev` toggles the trace.

---

## Part VII — How this is tested

192 tests, and **not one of them touches the network.** That is not a
performance choice: if a test needs the real portal to run, the seam it is
testing is not real.

`tests/fakes.py` holds an in-memory implementation of every port —
`FakeProjectRepo`, `FakeAuthVerifier`, `FakeConversationStore`,
`FakeDocumentIndex`, `FakeAgentRuntime` — plus `make_token()`, which mints a
token exactly the way `Core.js` does so the auth tests exercise the real
contract.

| file | covers |
|---|---|
| `test_layering.py` | the architecture rules, by walking every file's imports |
| `test_auth.py` | the token contract, including a username containing `\|` |
| `test_parsing.py` | every shape a price, deposit or date arrives in |
| `test_matching.py` | every filter rule, one assertion each |
| `test_redaction.py` | all four (role × mode) pairs, **in both directions** |
| `test_projects_exec.py` | sheet shapes in, domain objects out; the cache |
| `test_tools.py` | the four tools against a fake repo |
| `test_agent.py` | the loop, driven by a scripted model |
| `test_chat_endpoint.py` | the SSE contract |
| `test_cli.py` | argument handling, session file, history hygiene |

Three of these are worth understanding, because they encode ideas rather than
behaviour.

**`test_layering.py` parses the AST of every file** and fails if `domain/`
imports anything external, if `tools.py` imports an adapter or mentions
`for_viewer`, or if anything but `container.py` constructs an adapter. It caught
a real mistake while this was being built: an adapter's exception type imported
into a route.

**`test_redaction.py` asserts both directions.** Nothing hidden leaks — and
nothing beyond the policy is removed. Over-redaction is a bug too: a realtor who
cannot see the builder's phone number has quietly been handed a worse tool.

**`test_agent.py` scripts the model** with `FunctionModel`, so the tests cover
*our wiring* — that a tool call reaches the right repo, that cards come from tool
results and not prose, that a failure degrades honestly — rather than whether an
LLM behaves. One test deliberately hangs a tool to prove the "searching…" event
arrives *during* the search rather than after it.

---

## Part VIII — When something breaks

A map from symptom to the place to look.

```mermaid
flowchart TD
    S["Something is wrong"] --> Q1{"Does /health say ok?"}
    Q1 -->|no| C1["config or the portal.<br/>Run /doctor for the detail"]
    Q1 -->|yes| Q2{"Do you get 401?"}
    Q2 -->|yes| C2["/doctor with the same token.<br/>portal_auth vs token_verification<br/>separates a wrong key from a stale session"]
    Q2 -->|no| Q3{"Are answers empty<br/>or missing projects?"}
    Q3 -->|yes| C3["/doctor?fresh=1 →<br/>data_quality tells you how many<br/>projects and how many bad prices"]
    Q3 -->|no| Q4{"Is a number wrong?"}
    Q4 -->|yes| C4["aura --dev shows which tool ran<br/>with which arguments.<br/>Then parsing.py or matching.py"]
    Q4 -->|no| C5["aura --raw shows the events verbatim"]
```

| symptom | most likely | where |
|---|---|---|
| every realtor gets 401, `/health` green | `TOKEN_SECRET` does not match the portal | `/doctor` → `token_verification` |
| `unknown action: aiindex` | code pushed but the deployment not republished | edit the existing deployment, never "New deployment" |
| answers say a real project does not exist | a name did not resolve | `--dev` shows the tool call; `tools.get_project` |
| a price filter returns nothing | the column is empty, not the filter broken | `/doctor` → `data_quality` |
| a price is read wrongly | a format the parser refuses | `parsing.py`, and add the case to `test_parsing.py` |
| a sheet edit is not visible | the five-minute or six-hour cache | `/doctor?fresh=1` |
| chat hangs with no `done` | a runtime that raised | the stream always ends in `done` or `error`; if not, look at `chat.py`'s guard |
| the whole portal is slow | Apps Script's daily runtime is shared | see invariant #4 |

---

## Part IX — The rules that hold it together

Four ideas explain most of the code.

### 1. Depend on interfaces, construct in one place

Every external dependency sits behind a `Protocol`, with one adapter, built only
in `container.py`. `tests/test_layering.py` walks the AST of every file and fails
if `domain/` imports anything external, if `tools.py` imports an adapter, or if
anything but the container constructs one.

### 2. Guarantees live in code; requests live in the prompt

The prompt holds what the model is *asked* to do: tone, tool choice, what to say
when it cannot answer. It does **not** mention redaction, read-only access, or
the result cap — those are enforced structurally, because a prompt instruction is
a request and this agent answers questions about other people's money.

The clearest expression of this is the redacting repo. It is not that it filters
— the previous version filtered too, in a helper each tool had to remember to
call. It is that **there is no code path that returns something it has not
filtered.** `test_layering` fails if `tools.py` so much as mentions `for_viewer`.

The same lesson appeared again in a different costume. Told to search when a
lookup missed, the model often did not — and told a realtor their own project did
not exist. Instructing a model is a request; handing it the data is a guarantee.
So `get_project` now does the search itself and returns the candidates.

### 3. Never guess a number

An ambiguous value returns `None` and the project drops out of the filter. A
missing answer is recoverable; a confident wrong one is not. `is_blank()` is
public precisely so callers can tell *"nobody filled this in"* from *"the parser
could not read this"* — both produce `None` and mean opposite things about the
data's health.

### 4. The realtor's own token is the credential

Forwarded unchanged to the portal. No service account, no standing privilege.
Whatever the portal will not show that realtor, it will not show Aura Chat, and a
revoked realtor loses both in the same window.

---

## Part X — What is not built yet

| | |
|---|---|
| **The chat screen** | Goes in `Script.html`, not `www/app.js` — the PWA is generated from it |
| **The project page** | AUR-5. Unblocked now that `PROJECT ID` is populated |
| **Conversation storage** | Phase 4. History is client-supplied until then |
| **Document retrieval** | Phase 5. PDF → chunks → pgvector, as the *fallback* when the columns cannot answer |
| **Audit logging, rate limiting** | AUR-20, AUR-21 |

And one thing that is built but has no data: **prices**. Every layer handles them
— parsing, filtering, sorting, cards. `"detached under $1M"` returns zero results
today, correctly, because no project has a price recorded. When Sudhanshu's
columns land, that query starts working with no code change.

---

## Appendix A — The event contract

Everything `/chat` can emit.

| event | when | shape |
|---|---|---|
| `start` | first, always | `{type, mode}` |
| `tool` | the model calls a tool | `{type, tool, args}` |
| `tool_result` | the tool returns | `{type, tool, count}` |
| `text` | each delta of the answer | `{type, text}` |
| `projects` | after the answer | `{type, projects: [...]}` |
| `done` | last, on success | `{type, usage: {requests, input_tokens, output_tokens}}` |
| `error` | instead of `done` | `{type, detail}` |

A stream ends with exactly one of `done` or `error`. A client waiting for `done`
will never wait forever.

## Appendix B — Glossary

| Term | Meaning here |
|---|---|
| **Port** | A `Protocol` describing what something must do, with no implementation |
| **Adapter** | One concrete implementation of a port |
| **Composition root** | `container.py`, the only place adapters are built |
| **Claims** | The verified contents of a token: who is asking |
| **Viewer** | Role × mode: what this particular screen may show |
| **Client Mode** | The realtor has turned their phone toward a buyer |
| **SSE** | Server-Sent Events: one HTTP response written to over time |
| **Tool** | A Python function the model may ask to run |
| **The portal** | The existing Apps Script web app and its Sheets |
| **`aiindex`** | The one read-only action Aura Chat added to the portal |
