# Aura Chat — operations

Everything environmental: getting a token, what each setting does, deploying,
and rotating the one secret whose failure is invisible. Referenced from
[`../../AGENTS.md`](../../AGENTS.md).

---

## 1. Getting a portal token

`/doctor`, `/me` and every tool call need a realtor's own session token — this
service holds no credential of its own, so there is no way around having one.
Two ways to get it.

**Mint one against the portal.** `login` is a public action, so this needs only
a real Portal ID and password:

```bash
EXEC=$(grep -o "https://script.google.com/[^']*" dev/config.mjs | head -1)
curl -sL "$EXEC" -H 'Content-Type: text/plain;charset=utf-8' \
  -d '{"action":"login","username":"YOUR_ID","password":"YOUR_PASSWORD"}'
```

Answers `{"ok":true,"name":…,"role":"realtor","token":"…"}`.

Two details that are the difference between JSON and a wall of Google HTML.
`-L`, because Apps Script answers a POST with a 302 and serves the body from
`script.googleusercontent.com`. And **no `-X POST`** — `-d` already makes it a
POST, while `-X` pins the method across the redirect too, and that second hop
only answers GET. With `-X POST` you get a 405 and an HTML error page.

**Or lift it from the installed app.** In the PWA's devtools console:

```js
sessionStorage.getItem('ak_token') || localStorage.getItem('ak_token')
```

`sessionStorage` is where it lands when "Remember me" was unchecked.

Then:

```bash
TOK='<paste>'
curl -s -H "Authorization: Bearer $TOK" localhost:8000/doctor | python3 -m json.tool
```

A token is valid for 7 days from issue and the portal slides it on every app
launch. It carries the realtor's role, so an admin token and a realtor token
see different things — test with the one whose experience you are debugging.

**Never paste a token into a commit, a doc, an issue, or a log line.** It is a
bearer credential for that realtor's whole account.

---

## 2. Settings

Every one is read in `app/config.py` and nowhere else. `.env` is git-ignored;
`.env.example` is the template.

| Variable | Default | What it does |
|---|---|---|
| `TOKEN_SECRET` | *(none — refuses)* | HMAC key for portal session tokens. See §4. |
| `EXEC_URL` | *(none)* | The deployed Apps Script web app. Must equal `EXEC` in `dev/config.mjs`. |
| `EXEC_TIMEOUT_S` | `30.0` | Per-request timeout against the portal. Cold index builds are slow; see [`../portal.md`](../portal.md) §3.6. |
| `SESSION_MS` | `604800000` (7 days) | Token lifetime. **Must match `SESSION_MS` in `Core.js`** — longer here keeps honouring tokens the portal has retired. |
| `ALLOWED_ORIGINS` | `http://localhost:4600,http://localhost:4599` | Comma-separated CORS allowlist. The PWA's origin **must** be in here or the browser blocks the chat before the request leaves the phone. Never `*`: a wildcard lets any page a realtor visits spend their token. |
| `ALLOWED_ORIGIN_REGEX` | *(empty)* | Only for Netlify deploy previews, which get a random subdomain per draft deploy and so cannot be named in the list. A standing hole in the allowlist — set it while testing previews, unset it after. |
| `OPENROUTER_API_KEY` | *(none)* | Phase 3. |
| `LLM_MODEL` | `google/gemini-2.5-flash` | Phase 3. A model swap is this string. |
| `DATABASE_URL` | *(none)* | Phase 4. |

Two things are deliberately **not** settings: the `aiindex` cache window
(`ExecApiProjectRepo.TTL_S`, 5 minutes) and the result caps in `tools.py`
(`MAX_RESULTS`, `MAX_COMPARE`). They are tuning decisions with reasons written
next to them, not per-environment knobs.

---

## 3. Deploying

Railway, from the `Procfile`: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

1. Set `TOKEN_SECRET` and `EXEC_URL` in Railway's variables. The service starts
   without them and then refuses every request — `/doctor` names which is
   missing, `/health` deliberately does not.
1b. Set `ALLOWED_ORIGINS` to the PWA's origin. Without it the chat screen fails
   in the browser with a CORS error and a green `/health` — the request never
   reaches the service, so nothing here records that it happened.
2. **Set a usage limit on day one.** Railway has no spend cap by default; this
   is a listed risk in [`architecture.md`](architecture.md) §7.
3. `GET /health` should answer `{"status":"ok","ok":true}` from the internet.
4. `GET /doctor` with a real token is the actual readiness check — it proves the
   portal accepts our auth *and* that project data comes back.
5. **Prove the host does not buffer.** The chat is nothing but a stream, and a
   buffering proxy turns it into a five-second blank followed by a wall of text
   — with the same 200 as a healthy one, so nothing else catches it:

   ```bash
   curl -N -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
     -d '{"question":"cheapest project"}' https://<service>/chat
   ```

   Events must appear one at a time. This is why Netlify's redirect proxy was
   rejected as a way to make the service same-origin: it buffers, and long
   responses 502.
6. Rebuild and redeploy the PWA with `AURA_BASE` pointing at the service —
   `AURA_BASE=https://<service> node dev/deploy.mjs --prod`. Until that is set,
   the bundle ships without the chat button by design; see
   [`../portal.md`](../portal.md). The Apps Script-hosted copy never gets it:
   its pages come from a `googleusercontent.com` subdomain whose hash varies, so
   the origin cannot be allowlisted, and Apps Script cannot stream anyway.

---

## 4. Rotating `TOKEN_SECRET`

The secret now lives in **two** managed stores, and they must agree byte for
byte. A mismatch is the worst failure mode in the system: every realtor gets
401 from Aura Chat while `/health` stays green and the portal itself keeps
working normally.

Rotation is therefore not atomic, and every existing token dies with the old
value. Do it when nobody is mid-conversation:

1. Apps Script → *Project Settings → Script Properties* → set `TOKEN_SECRET`.
2. Railway → variables → set the identical value → redeploy.
3. `GET /doctor` with a **freshly minted** token (§1). `token_verification`
   must say `verified as <user>`.
4. Every realtor must sign in again. Tokens minted under the old secret no
   longer verify anywhere.

If step 3 reports *"the portal accepts this token but this service cannot
verify it"*, the two values differ — usually a trailing newline or a partial
paste.
