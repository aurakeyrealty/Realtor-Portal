# Aura Chat

AI assistant for Aura Key Realty realtors. Reads the portal's project data over
the existing Apps Script API; stores its own conversations. Design and rationale:
[`../docs/aura-chat/architecture.md`](../docs/aura-chat/architecture.md).

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env          # then fill TOKEN_SECRET
.venv/bin/python -m pytest -q
.venv/bin/uvicorn app.main:app --reload
```

`TOKEN_SECRET` must be byte-identical to the Script Property in the Apps Script
project. A mismatch means every realtor's token fails here while still working
in the portal — the symptom is a universal 401 with a healthy `/health`.

## Layout

| Path | Rule |
|---|---|
| `app/domain/` | the business shape. Imports nothing external. |
| `app/ports/` | Protocols only. Five seams, no more. |
| `app/adapters/` | one implementation per port. |
| `app/tools.py` | the AI's tools. Imports `domain` + `ports` only. |
| `app/agent.py` | the only file that may import an agent framework. |
| `app/container.py` | the only file that may construct an adapter. |

`tests/test_layering.py` enforces all of that. If it fails, the swap described
in the architecture doc has quietly stopped being a one-file change.

## Endpoints

All three take the realtor's own portal token as `Authorization: Bearer <token>`,
except `/health`. See [`../docs/aura-chat/operations.md`](../docs/aura-chat/operations.md)
for how to get one.

| | |
|---|---|
| `GET /health` | Public liveness. Returns `{status, ok}` only — deliberately uninformative, so a stranger cannot learn which secret is unset. |
| `GET /doctor` | The full diagnosis, for a signed-in human. `?fresh=1` rebuilds the caches. |
| `GET /me` | Proves the auth path end to end without touching project data. |
