# Aura Chat — build state and planned files

What is wired, what is next, and the names already chosen for files that do not
exist yet. Phase detail and done-signals live in
[`architecture.md`](architecture.md) §5. Referenced from
[`../../AGENTS.md`](../../AGENTS.md).

---

## Where the build actually is

`Container` is the honest status board: a field that is `None` is a phase that
has not shipped, and `/health` and `/doctor` report those as `null`, not as
failures.

| Phase | Scope | State |
|---|---|---|
| 1 | Skeleton, config, auth, portal client, `/health` `/doctor` `/me` | **done** — 40 tests green |
| 2 | `aiindex` action, `projects_exec.py`, `filters.py`, `tools.py` | next |
| 3 | `agent.py`, SSE endpoint, chat screen in the PWA — **the Day 1 gate** | not started |
| 4 | Postgres persistence, history, Client Mode, sources, feedback | not started |
| 5 | Document retrieval over pgvector; structured-first | not started |
| 6 | Audit logging, chat-specific rate limit, latency, 50-question benchmark | not started |

Phase detail and done-signals: architecture doc §5. **Do not build ahead of the
current phase.** The ports for later phases are declared so tools and tests can
be written against them — that is not an invitation to implement them early.

---

## Files not written yet, already named

Use these names and locations; do not invent alternatives. If what you need is
not on this list, that is a design decision — ask.

| File | Phase | What it is |
|---|---|---|
| `app/tools.py` | 2 | The AI's tools as plain typed async functions. Imports `domain` + `ports` only |
| `app/adapters/projects_exec.py` | 2 | `ProjectRepo` over the exec API. **No column name escapes this file** |
| `app/adapters/filters.py` | 2 | TTL cache + filtering over the `aiindex` payload |
| `app/agent.py` | 3 | The **only** file permitted to import an agent framework |
| `app/adapters/store_postgres.py` | 4 | `ConversationStore` |
| `app/adapters/docs_pgvector.py` | 5 | `DocumentIndex` |
