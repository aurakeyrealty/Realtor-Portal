# Deploying the service

Railway, project `aura-chat`, from `aura-chat/`.

## The one command

```bash
railway up ./aura-chat --path-as-root --service aura-chat
```

Run it **from the repo root**, and do not drop `--path-as-root`.

## Why that flag is not optional

`railway up` uploads from the **git repository root**, not the working
directory. This service lives in a subdirectory of the portal's repo, so a plain
`railway up` from inside `aura-chat/` ships the whole portal — `Core.js`,
`App.html`, `netlify.toml` — and Railpack looks at that, finds no Python, and
fails with *"could not determine how to build the app"*.

The failure is easy to misread. The build produces no useful log through
`railway logs --build` (two lines, both "scheduling build"), and
`railway status` just says Failed. The real message is only visible in the
dashboard's build log, or through the API:

```bash
railway api 'query($id:String!){ buildLogs(deploymentId:$id, limit:400){ message } }' --var id=<DEPLOYMENT_ID>
```

`--path-as-root` makes `./aura-chat` the archive root, so Railpack sees
`pyproject.toml`, `Procfile` and `.python-version` at the top level, which is
what it needs.

The alternative — setting the service's Root Directory to `/aura-chat` in the
dashboard and deploying without the flag — also works, but **not both**: with
Root Directory set, the flag would make Railway look for `aura-chat/aura-chat`.

## Python version

`.python-version` pins 3.13. `pyproject.toml` says `requires-python = ">=3.12"`,
which leaves the builder free to pick something older and fail on install.

## Variables

Set once, in Railway, never in the image:

| Variable | Note |
|---|---|
| `TOKEN_SECRET` | **Byte-identical to the portal's Script Property**, or every realtor gets 401 while `/health` stays green |
| `EXEC_URL` | The deployed Apps Script web app |
| `OPENROUTER_API_KEY` | |
| `LLM_MODEL` | |
| `ALLOWED_ORIGINS` | The PWA's origin. Without it the browser blocks the chat before the request leaves the phone, and nothing here records that it happened |
| `ALLOWED_ORIGIN_REGEX` | Netlify draft deploys only. A standing hole in the allowlist — unset it when preview testing ends |

## After deploying

```bash
curl https://<service>/health
curl -H "Authorization: Bearer $TOK" https://<service>/doctor
```

`/doctor` is the real readiness check: it proves the portal accepts our auth
*and* that project data comes back. Then prove the host does not buffer, because
a buffering proxy returns the same 200 as a healthy one:

```bash
curl -N -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"question":"cheapest project"}' https://<service>/chat
```

Events must print one at a time.
