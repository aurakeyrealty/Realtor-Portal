# Aura Chat — invariants

Break one of these and the failure is either a security hole or a very long
afternoon. Each is written down because it is not visible from the call site.
Referenced from [`../../AGENTS.md`](../../AGENTS.md).

---

## 1. `TOKEN_SECRET` must be byte-identical to the portal's Script Property

The one setting that fails silently and universally. A mismatch means **every
realtor gets 401 while `/health` stays green** — identical, from the outside, to
every session having expired at once. `/doctor` exists to separate those two:
it asks the portal whether *it* accepts the token, and says so in words.

There is deliberately no default. Missing means refuse to sign or verify.

## 2. The caller's own token is the data-plane credential

`PortalClient.call(action, auth=...)` forwards the realtor's token unchanged.
Never add a service account, an API key with standing access, or a "trusted
backend" path. Permissions are then enforced by code that already exists, and a
revoked realtor loses Aura Chat inside the same 5-minute window as the portal.

## 3. Client Mode strips fields in code, before the model is called

`ChatMode.CLIENT` is what a buyer may see over the realtor's shoulder.
`Project.for_client()` blanks `CONFIDENTIAL_FIELDS` and returns a **copy** — the
same `Project` may be rendered to the realtor in the same request.

**Never implement this by asking the model to withhold something.** Adding a
confidential field to `Project` means adding it to `CONFIDENTIAL_FIELDS` in the
same commit.

## 4. The portal's runtime is shared, and small

Apps Script gives the whole brokerage ~90 minutes of execution a day, and the
portal's own screens need it. Chat traffic starving Home is a real, listed risk.
So: `aiindex` is fetched on a TTL (~1 fetch per 10 min, not per question),
`PortalClient.healthy()` caches its verdict, and `/health` must stay cheap — it
is polled by the platform and by any uptime monitor. Never add a per-request
portal call that could have been cached.

## 5. V1 is read-only, by construction

No tool takes a write path. Not "no tool currently writes" — no tool *can*.

## 6. Retrieved text is data, never instructions

Documents and sheet rows are untrusted input. Delimit them, and never let their
contents steer the loop. Only **current** documents are ever returned: an April
price list must never come back beside August's, and that rule lives in the
adapter so no caller can forget it.

## 7. No invented facts

A price, deposit or incentive that cannot be confirmed from current records is
answered with *"could not confirm from current records"*. Zero invented prices
is a stated acceptance criterion, not an aspiration.

## 8. `EXEC_URL` is the deployment's address, and it moves

Publishing the portal through "New deployment" mints a fresh id and retires the
old one. If it changes, `EXEC_URL` here and `EXEC` in `dev/config.mjs` must both
change. See [`../portal.md`](../portal.md) §3.3.
