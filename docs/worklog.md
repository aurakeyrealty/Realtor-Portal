# Worklog

Why things are the way they are. Newest first.

The code says *what*. Git says *when*. This says **why** — the option that was
rejected, the constraint that forced a shape, the bug that a comment now guards
against. If you are about to undo something here, the entry should tell you what
it will cost.

**One entry per substantive change.** Keep it short: a decision, its reason, and
anything a future reader would otherwise have to rediscover. Skip typo fixes and
formatting.

---

## 2026-08-24 — The ONTARIO tab is dropped from the index

**What.** `ROLLUP_CITIES` in `projects_exec.py`. Rows whose CITY is ONTARIO
never become a `Project`. 250 rows become 163.

**Why.** ONTARIO is a tab, but it is not a city. It held 87 of the sheet's 250
rows, and 63 of its 84 distinct names already had a row on a real city tab. The
two rows for one project disagree:

| | CALEDON row 6 | ONTARIO row 31 |
|---|---|---|
| builder | Fernbrook / Zancor Homes | Fernbrook/Zancor |
| type | Townhome/Detached | Detached |
| occupancy | 2027/2028 | 2026 |
| focus | yes | no |

Nothing in the payload marks the pair as the same building, so both reached the
model as separate projects and either occupancy could be quoted as fact. A
realtor saw it as a location: "Whitby Meadows by Opus Home **in Ontario**".

The remaining 22 rows are aliases of projects listed elsewhere under their
proper names (`Duo` for DUO Condos, carrying a staler 2025 occupancy; `Brightside`,
`Castlemile`, `Wildflowers`) and four entries that are not projects at all
(`All Treasure Hills Projects`, `Mattamy All Projects`). About nine may be
genuinely unique, all of them without a city, a price, or in most cases a
builder. Sarath's call: let them go. If one turns out to be real, the fix is a
row on its own city tab, not keeping the roll-up alive.

**Rejected.** Doing it in `Ai.js`, server-side. Fewer rows over the wire, but it
costs a `clasp push` and an edit to the live deployment, and undoing it costs
another. In the adapter it is a one-line revert and the sheet keeps whatever use
the tab has for Sudhanshu.

**Also rejected:** de-duplicating by name instead of dropping the tab. It needs
a rule for which row wins when they conflict, and the sheet gives no basis for
one.

**Cost of undoing.** The 63 duplicates come back, and with them the ability to
quote either of two occupancy dates for the same project.

**Watch for.** `skipped_rollup_rows` is reported by `/doctor` on purpose. If it
ever reads 0 against the live sheet, the tab was renamed and the duplicates are
back in the index.

---

## 2026-08-24 — Docs audit: reconcile the guides with the code

**What.** Audited AGENTS.md and the six docs it points at against the tree.
Phase 2 had landed; most of the drift was from that one commit. Fixed the stale
facts, added `docs/aura-chat/operations.md`.

**The drift worth naming.** `roadmap.md` still called Phase 2 "next" and listed
`filters.py` as unwritten — a file that was deliberately never built, because
filtering became `domain/matching.py` (pure, so a SQL adapter reuses the
semantics) and the cache went inside the adapter. A roadmap that names a file
nobody intends to write is worse than one that says nothing: the next agent
creates it. It now records the supersession rather than the plan.

**Numbers that had drifted:** the `aiindex` window is `TTL_S = 300` (5 min), not
the "~10 min" three docs had inherited from the pre-build estimate; ruff reports
~16 findings, not ~10; the test count was 40 in one doc and 116 in another.
`/health` was still documented as returning a per-check breakdown, which it
stopped doing when the output was deliberately redacted.

**Why operations.md exists.** Two docs told the reader to send
`Authorization: Bearer <portal token>` and neither said where a token comes
from, so `/doctor` was undocumented in practice. It now carries the token
recipe, the full settings table, the Railway steps, and the `TOKEN_SECRET`
rotation runbook the architecture doc's risk table asked for and nobody wrote.

**One trap found by running the recipe rather than writing it.** `curl -X POST
-L` against the exec URL returns a Google HTML error page, not JSON: `-X` pins
the method across the 302, and the googleusercontent hop only answers GET. `-d`
alone is correct. The reason is written next to the command — it is otherwise
an afternoon of assuming the deployment is broken.

**Left open, deliberately:** `project_source` is declared in `config.py` and
read nowhere (`build()` constructs `ExecApiProjectRepo` unconditionally, though
its comment claims otherwise), and `project.py` groups `broker_url` under
`# links` while `CONFIDENTIAL_FIELDS` strips it. Both are decisions, not
typos.

---

## 2026-08-24 — A walkthrough of the whole system

**What.** [`how-it-works.md`](aura-chat/how-it-works.md) — 1,049 lines, twelve
diagrams, ordered as a story: an empty process, then boot, then every file, then
one chat interaction traced end to end, then the other flows, the CLI, the
tests, and a troubleshooting map.

**Why it is separate from `architecture.md`.** That doc answers *why this shape*
— the options weighed, the ones rejected. This one answers *how it works*, for
someone who has already accepted the shape and needs to change something. Merging
them would make both worse: a person debugging a 401 at 11pm does not want to
read why Cloudflare Workers lost.

**What the second pass changed**, because the first draft was written partly from
memory and it showed:

- **The `/doctor` section was wrong.** Check order was off, and it omitted the
  redaction path for unverified callers. Worse, it missed the point: `portal_auth`
  and `token_verification` are a *pair*, and reading one against the other is what
  separates a mismatched `TOKEN_SECRET` from a stale session — the two failures
  that are indistinguishable from outside. That is now a diagram.
- **No method-level index**, which was half of what was asked for. A file list
  tells you nothing when you are hunting for where a thing happens.
- **The CLI was not traced at all**, including the login sequence — the one flow
  that touches a password.
- **Nothing on testing or on debugging.** Part VIII is a symptom → cause → file
  table with a decision tree, and is likely to get more use than any other part.

**The rule that emerged from doing it:** explain mechanisms, not structure. A
list of files is a directory listing. Why a queue and not a list, why filtering
runs before redaction, why `_to_project` is a boundary — those are the decisions
that look arbitrary in six months, and they are what a walkthrough is for.

---

## 2026-08-24 — `aura`, a terminal client with a dev mode

**What.** A CLI that signs in, asks questions, holds a conversation, and in
`--dev` shows every tool call, its arguments, timings and token usage. Plus the
service-side pieces it needed: `POST /login`, history on `/chat`, and `tool` /
`tool_result` events on the stream.

**Why over HTTP rather than in-process.** It hits the real endpoint with a real
token, so it exercises auth, SSE and the exact contract the PWA will consume. A
client that reached into the app directly would keep passing while the endpoint
was broken, which is the one thing a client is for.

**Why it signs in rather than taking a pasted token.** `aura login` prompts,
posts to `/login`, and stores only the token — at `0600`, never the password.
Copying a token out of browser storage by hand is the kind of step people skip,
and skipping it means the tool goes unused. The route passes the portal's own
wording through: *"too many attempts"* and *"invalid id or password"* mean
different things to whoever is trying to get in.

**History is text only, in our own shape.** `{role, content}`, deliberately not
PydanticAI's message type — the wire contract outlives whichever loop runs
underneath. Tool results are not replayed: a price the sheet has since changed
would go back into the prompt with no way for the model to know it was stale.
Client-supplied until Phase 4's server-side store replaces it.

### The streaming fix, which was not cosmetic

Tool events were collected into a list drained inside the text loop — and
`stream_text` yields nothing until the model has finished calling tools. So the
buffer could only flush *after* the work it described. Measured live: everything
landed together at 4300ms. Through an `asyncio.Queue` produced by a background
task, the tool event now arrives at 2252ms and the first text at 4300ms — two
seconds of "searching…" where there had been a blank spinner.

That restructure brought a second fix with it: the consumer now cancels the task
in a `finally`. **A realtor closing the app mid-answer previously left the run
going, and billing, with nobody reading it.**

### Two smaller ones worth remembering

- **A failed turn must not enter history.** `ask()` returns an empty answer on
  an error event, and the REPL was recording that as an assistant message with
  empty content. Some providers reject those outright, so one failure would
  poison every question after it. Both turns are dropped now — keeping the user
  turn alone would leave consecutive user messages, which fails the same way.
- **A subcommand is one bare word.** `aura login details for Great Gulf` used to
  match on the first word and open a password prompt. Being unexpectedly asked
  for a password is the least welcome thing a tool can do.

**`--help` needed writing, not generating.** `login` and `logout` are positional,
so argparse will not advertise them: the original help listed six flags and no
way to sign in at all. Four tests now assert the epilog covers signing in, the
interactive commands, every environment variable the code reads, and that the
service must be running — one of which caught me documenting `login` and
forgetting `logout`.

---

## 2026-08-24 — Phase 3: the agent, answering live

PydanticAI over OpenRouter, four tools bound to the redacting repo, `POST /chat`
streaming SSE. Verified against real Aura data with a real realtor token.

**Cards come from tool results, never from the prose.** If the model says "around
$1.2M" about an $899,900 project, the card still says $899,900. Restating numbers
is how they drift between the sheet and the buyer.

**The runtime is handed a repo, it does not hold one.** The client sends `mode`,
but nothing downstream trusts it beyond choosing a `Viewer`; the redacting repo
is built in the endpoint, so the agent cannot widen its own access. Confirmed:
in Client Mode `"4%"` never appears anywhere in the model transcript.

**What the prompt carries vs what the code carries.** The prompt holds rules the
model is *asked* to follow — tone, tool choice, what to say when it cannot
answer. Redaction, read-only and the result cap are not in it, because a prompt
instruction is a request and this agent answers questions about other people's
money.

### Two bugs that only live testing could find

1. **`max_tokens` defaulted to 65535.** Providers advertise their whole context,
   and OpenRouter reserves credit against that number *before* the call — so
   every request was refused 402 for lack of credit to cover an answer nobody
   wanted. Capped at 1500, which is generous for a reply the prompt asks to keep
   to two or three sentences.
2. **`get_project` accepted only ids.** A realtor naming a project hands over a
   *name*; the model passed the name, got nothing, and told them their own
   project did not exist. "What's the deposit for X?" is among the commonest
   questions there is.

The second fix is the more interesting one. Resolving names in the tool was not
enough: told to search when a lookup missed, the model often did not. So the tool
now does the search itself and returns the candidates — two Brampton projects
really are both called "Mayfield Village", and the realtor needs to be asked
which, not told neither exists.

**That is the same lesson as the redaction work.** Instructing a model is a
request; handing it the data is a guarantee. Anything that must hold belongs in
code, and "must hold" includes not denying that a brokerage's own inventory
exists.

**Known gap.** "I could not find any detached homes under $1M" does not
distinguish *no matches* from *no prices recorded anywhere*, and a realtor could
reasonably read it as the former. Mostly self-resolving once the commercial
columns are filled, but the tool could say which it is.

---

## 2026-08-24 — Redaction became a property of the repo, not a step

**What.** `Viewer` (role × mode), `Project.for_viewer()`, and a
`RedactingProjectRepo` decorator built per request. `tools.py` lost its
`_present()` helper entirely.

**Why, given `_present()` already worked.** It was **opt-in**. Every tool had to
remember to call it, and a tool that forgot would leak silently — no error, no
log, no undo, just commission on a screen a buyer is looking at. That rule holds
right until someone adds a sixth tool at 11pm on Tuesday.

Tools are now handed a repo that cannot return an unredacted `Project`. The
guarantee is structural rather than procedural, which is what AUR-18 and AUR-55
actually ask for: stripped **in code before the model is called**, never by
asking the model to withhold something.

**Two axes, not one.** Role is what the *account* may ever see; mode is what is
on the screen *right now*. They are unioned, never intersected — an admin in
Client Mode is still showing a buyer a screen, so entitlement never buys back a
client-hidden field. Collapsing them into a single flag would get one of the
four combinations wrong.

**The subtlety that shaped the decorator.** Search filters the **unredacted**
records and redacts the results. A query may legitimately *use* a field it may
not *show*; redacting first would silently change which projects come back
depending on who is looking — a far worse bug than showing too little.

**Enforcement, not memory.** `test_layering.py` now fails if `tools.py` mentions
`for_viewer`, and if anything above the container reaches `container.projects`
directly instead of `projects_for(viewer)`. `test_redaction.py` is exhaustive
over all four (role, mode) pairs and asserts both directions: nothing hidden
leaks, and nothing beyond the policy is removed — over-redaction quietly hands a
realtor a worse tool.

**`status` joined the client-hidden set.** "Focus" is an internal sales signal,
not something to show a buyer.

**Also:** `/doctor`'s project probe now goes through the wrapper at the strictest
setting. A check that takes a shortcut past the layer it is meant to prove has
stopped being a check.

---

## 2026-08-24 — Four parsing and freshness bugs, from review

All four produced **wrong answers rather than errors**, which is the failure mode
this project can least afford, and none had a test.

1. **`recent()` measured its window from the newest row, not from today.** A sheet
   untouched for six weeks would still report its newest projects as "what changed
   this week" — freshness the sheet never claimed — and an empty result was
   impossible, so "nothing changed recently" could never be answered.
2. **A price range in a single column lost its high end.** The `parse_price_range`
   fallback was guarded by `if low is None`, but `parse_money`'s regex is
   unanchored and happily returns the first number in `"$800,000 - $1,400,000"`.
   The guard could never fire. A project selling up to $1.4M was excluded from an
   "at least $1M" search. The price cell is now read as a range in every case.
3. **`parse_percent` turned `"1%"` into 100%.** The correction for percent-formatted
   cells displaying as fractions fired on any value ≤ 1 without noticing that a
   percent sign had already said what the value was. A 1% deposit became a 100%
   one: excluded from every "max 10% deposit" search, and if shown, telling a
   realtor the buyer pays the whole price up front.
4. **`TBD` was counted as a parser failure.** `parse_money` returns None for
   placeholders by design, so 40 projects correctly marked "TBD" would have
   reported as 40 unreadable prices and pushed `/doctor` to degraded — burying the
   one signal that check exists to give.

**The shape shared by 1, 2 and 4:** each is a value that is *absent or unknown*
being treated as a value that is *known*. `is_blank` is now public precisely so
callers can tell "nobody filled this in" apart from "the parser could not read
this" — they both produce None and mean opposite things about the data's health.

**Worth noting:** the existing 120 tests passed against all four. Coverage of the
happy path says nothing about whether the edges are right.

---

## 2026-08-24 — Phase 2 verified against live data

`/doctor` green end to end with a real realtor token: 246 projects read from the
live sheets in ~2s, `token_verification` and `portal_auth` both passing.

**Two things this shook out:**

1. **A refresh needs its own timeout.** `refresh()` busts both caches, which makes
   the portal walk all ~38 city tabs — about a minute. The ordinary 30s read
   budget cut it off mid-rebuild and surfaced as a bare "portal unreachable".
   `PortalClient.call` now takes a per-call override and the refresh path uses
   240s.
2. **`data_quality` counts rejected values, not missing ones.** "246 projects" with
   no unparsed count reads like success; in fact every price cell was empty. The
   check is honest about what it measures, but the number needs reading carefully:
   it answers "did anything fail to parse", not "is there anything there".

**State of the data as of this run:** `PROJECT ID` is populated for all 23
BRAMPTON projects and addresses are in, so the whole sheet-to-domain chain is
proven. `STARTING PRICE`, `BEDROOMS`, `DEPOSIT %`, `INCENTIVES` and
`LAST UPDATED` are present as headers with empty cells. Nothing to parse yet, so
the price format stays an open question until Sudhanshu writes the first few
values — deliberately not agreed in the abstract, because a format settled
before contact with real data tends not to survive it.

**Also confirmed:** deploying is domain-restricted. `clasp push` works from any
account with edit access; publishing needs an account in the script owner's
domain (`office@aurakeyrealty.ca`). The deployment went `@22 → @25` on the same
id, so the URL every installed phone calls is unchanged.

---

## 2026-08-24 — Aura Chat Phase 2: tools over live data

**What.** `Ai.js` and one `aiindex` action in the portal; `ProjectRepo` over it;
price/deposit/date parsers; the filter rules; four tools. 116 tests.

**Why one big payload instead of a filtered query.** The service caches the whole
index for five minutes and filters in Python, so a busy conversation costs one
portal fetch per window rather than one per question. Apps Script runtime is a
single daily budget shared with the realtors' own app; protecting it is why Aura
Chat runs outside Apps Script at all.

**Why a separate cache key.** `index_api` backs the portal's Cities and Focus
screens and sits on the Home hot path. Both indexes are built from the same
per-city `proj_<CITY>` entries, so the sheet reads are shared even though the
payloads are not.

**Decisions taken here:**

- **Extended `FIELD_KEYS` rather than reading the tabs twice.** `getProjects_`
  now emits the commercial columns too. Additive: an unmapped column reads as
  empty, so the 37 tabs without them behave exactly as before.
- **Slug ids as scaffolding.** A project with no `PROJECT ID` gets
  `city:project-name`, so deep links and comparison work while Sudhanshu fills
  the column. **Renaming a project changes its id** and any link minted
  beforehand stops resolving — the accepted cost of shipping before the data.
  A real id always wins.
- **Unavailable projects travel, and are filtered in Python.** The portal's own
  index drops them because its screens list what is for sale. Aura still has to
  answer "what happened to X?", so `search` hides them and `get` finds them.
- **The cache is in-process, in the adapter.** Not in `tools.py` (a Postgres
  adapter would not want it) and not in Postgres (phase 4). Known limit: on more
  than one worker each keeps its own copy, so the portal sees one fetch per
  worker per window. At this team's size we do not scale out.

**Two traps now guarded in code:**

- `FIELD_KEYS` binds each field to the **first** header containing its keyword,
  so `PRICE` would have matched ONTARIO's `PRICE RANGE`. The keyword is the whole
  `STARTING PRICE`. Comment sits on the table.
- A refused `aiindex` **raises** rather than caching an empty list. Caching a
  refusal would serve "no projects found" for five minutes, which a realtor
  cannot tell apart from an empty sheet.

**The rule the parsers follow: never guess.** `parse_money("1.2")` returns None
rather than choosing between $1.20 and $1.2M, and an unpriced project never
satisfies a price filter — it is *unknown*, not cheap. Letting it through is
precisely how an answer ends up asserting something the sheet never said. Two
corrections are deliberate exceptions, both documented at the call site: a range
yields its low end, and a deposit of `0.1` is read as 10% (a percent-formatted
cell displaying as a fraction).

Unparseable prices are **counted**, not logged: a spike means Sudhanshu has
started writing them a new way, and `/doctor` should say so before a realtor
finds out by getting a wrong answer.

**Not verified end to end.** `aiindex` is wired (`dev/verify.mjs` resolves the
dispatch target) and gated, but reading real rows needs a realtor token, which
this session did not have. First run with a real token is the outstanding check.

---

## 2026-08-24 — `dev/verify.mjs` learned extension globs; `Audit.js` is a server file

**What.** Two fixes to the stray-root-file check: `Audit.js` added to
`SERVER_FILES`, and the `.claspignore` matcher now honours `*.ext` globs.

**Why.** A code review flagged `AGENTS.md` and `CLAUDE.md` in `.claspignore` as
dead — `.clasp.json` only pushes `.js`/`.gs`/`.html`/`.json`, so Markdown is never
a push candidate. **That reasoning was right about clasp and wrong about the
repo.** Those lines were load-bearing for `dev/verify.mjs`, whose matcher
understood only exact names and directory prefixes. Removing them failed
verification for a reason invisible from the line itself.

Teaching the matcher globs was the better fix than restoring two lines: every
future doc is now covered without a new entry, and the check keeps doing its real
job — failing the day an unignored *code* path appears in the root.

`Audit.js` was simply missing from the list: it is a genuine server file, pushed
deliberately, and already documented as one in `AGENTS.md` §2.

**Worth remembering:** "this line looks redundant" is not the same as "this line
does nothing". Before deleting one, run the check that might be leaning on it.

---

## 2026-08-24 — `/health` split into a probe and a doctor

**What.** `GET /health` is now a terse public liveness probe. The real
diagnostics moved to `GET /doctor`, which requires a token and runs live checks:
`config`, `portal_reachable`, `portal_auth`, `token_verification`,
`project_data`, `conversation_store`, `document_index`.

**Why.** The original `/health` reported `app: true` (meaningless — it answered,
so it is up) and `auth_configured` (proves a setting is *present*, not
*correct*). Neither tells a realtor why an answer failed. It also could not check
the data path at all: every portal action except `login`/`session` needs a token,
and a public endpoint has none.

**Three things worth keeping:**

1. **`/doctor` accepts a token that does not verify.** Found while testing: with
   a wrong `TOKEN_SECRET` nothing verifies, so `/doctor` returned 401 — unreachable
   at exactly the moment it is needed. A doctor that stops working when the
   patient is sick is no use. It now diagnoses the refusal instead of refusing.
2. **It separates two failures that look identical.** A mismatched `TOKEN_SECRET`
   and an expired session both show as "every realtor gets 401 while /health is
   green". Cross-referencing local verification against the portal's own verdict
   distinguishes them, and says so in words.
3. **`/health` deliberately withholds what `/doctor` states.** A public endpoint
   naming which secret is unset tells a stranger when forging might work. An
   unverified caller to `/doctor` gets detail on `token_verification` and
   `portal_auth` only; the rest is redacted.

Severity is graded: no conversation store → `degraded` (history breaks, chat
works); no project data → `down`. So a platform restart policy fires on a real
outage, not on Postgres hiccuping.

---

## 2026-08-24 — Aura Chat Phase 1: service skeleton, ports and auth

**What.** `aura-chat/` — Python 3.12, FastAPI, ports-and-adapters. Domain models,
five Protocols, the portal HTTP client, an HMAC token verifier, a composition
root, and 40 tests.

**Why a separate service at all.** Apps Script cannot stream (`ContentService`
buffers), caps a fetch at ~60s, and — the deciding factor — shares a **single
daily runtime budget with the portal itself**. Chat traffic could take Home down.
It also blocks every Future ticket: document RAG, webhooks, push.

**Why it still reuses the portal.** The service calls the existing exec API as
its data plane, so `Sheets.js` readers, the cache layer and the permission model
are not re-implemented, and the Google Sheets API quota is never touched.

**Why the caller's own token is the credential.** The service forwards the
realtor's token unchanged. No service account, no standing privilege: whatever
the portal will not show that realtor, it will not show Aura Chat. A revoked
realtor loses chat in the same window they lose the portal.

**Auth needed two levels.** Python can check the HMAC signature and the 7-day
window, but *not* `credGen` or whether the account still exists — both need the
LOGIN sheet. So `verify_local()` is offline (rejects junk with no round trip) and
`verify()` delegates liveness to the portal's `session` action, cached 60s. If the
portal is *unwell* rather than refusing, a locally valid token is honoured —
otherwise an Apps Script outage signs out the whole team.

**Sharp edges recorded in code:**

- Token fields are parsed **from the end**. A username may contain `|`, so
  counting from the front misreads every other field. Same bug as `61b06fc`; now
  a test.
- `TOKEN_SECRET` must be byte-identical to the Script Property. A mismatch shows
  as a universal 401 with a green `/health` — hence `/doctor`.
- Lifespan only builds a container if none was injected. Building over an
  injected one silently replaced test fakes with real adapters reading a
  nonexistent `.env`.

**Rejected:** all-in Apps Script (no streaming, shared quota); Cloudflare Workers
(genuinely good and cheaper — lost on familiarity during a 2-day sprint; Hono and
FastAPI both port if we revisit); a Next.js rebuild (the PWA already delivers
phone + web + install + offline + auth); Vertex AI Agent Builder and Azure AI
Foundry (metered, high lock-in, and their auth models fight ours — realtors have
no Google or Microsoft identity); LangChain (300+ integrations and graph
orchestration for an agent with five tools and one loop).

---

## 2026-08-24 — Ports and adapters, so the data source can move

**What.** Five seams behind `Protocol`s: `ProjectRepo`, `ConversationStore`,
`DocumentIndex`, `AuthVerifier`, `AgentRuntime`.

**Why.** Two swaps are likely rather than hypothetical: project data is expected
to outgrow Sheets, and the agent framework is a fresh bet.

**What makes the data-source swap real** — not the Protocol, but two disciplines:

1. A source-agnostic `Project` domain model. Sheet headers, row numbers and
   `$899,900` parsing live **only** inside the adapter's `_map()`. The moment a
   column name leaks into `tools.py`, the swap stops being one file.
2. Ports expressed as **query intent**: `search(ProjectFilters) -> list[Project]`,
   never `read_tab()`. A tool that fetches everything and filters it itself works
   fine today — the sheet returns everything anyway — and silently blocks the move
   to SQL, where the same filter should become a `WHERE` clause.

`tests/test_layering.py` AST-walks imports and enforces all of it: `domain/`
imports nothing external, `ports/` declares only Protocols, and **only**
`container.py` constructs an adapter.

**Deliberately not ports:** the HTTP framework, the Postgres driver, and the model
provider — swapping OpenRouter for Gemini is already a model string inside the
runtime. A seam that will never gain a second adapter is cost with no return.
Hard cap: five ports, one adapter each during the sprint.

---

## 2026-08-24 — Discovery: what the portal actually holds

Full write-up: [`aura-chat/investigation-aur-3-4-5.md`](aura-chat/investigation-aur-3-4-5.md).

**The two findings that reshaped the sprint:**

1. **The city tabs carry no commercial data.** 38 tabs, 36 sharing one layout:
   project, builder, type, occupancy, status, three link columns. No price,
   deposit, bedrooms, incentives or address. The flagship demo query — *"show
   detached under $1M"* — could not be answered at all. This was not a
   data-quality gap to be cleaned; the columns had to be **created**. Sudhanshu
   began adding them to BRAMPTON on 2026-08-24.
2. **There is no project page and no project ID.** The deepest route was
   `#city/BRAMPTON`; projects render as cards whose links go *out* to builder
   portals. A project was addressable only as (tab, row number, name) — and the
   row number moves. That blocks `getProject`, `compareProjects`, deep links, and
   the Day 1 gate.

**The good news:** `buildSearchIndex_` already builds a warm, cached, cross-city
project array — and has **no action in the dispatcher**. It exists only to feed
`getFocus_` and `getCityCounts_`. Exposing and filtering it is most of the search
tool, not a build from scratch.

**Why filtering will happen in Python, not Apps Script:** one new read-only
`aiindex` action returns that array; the service caches it on a short TTL and
filters locally. Richer filters, no duplicated logic, and roughly one portal
fetch per TTL window instead of one per question — which is also the main
mitigation for the shared-runtime risk.

**A column rule worth not rediscovering.** New columns go on the **right**, never
at A. `getCities_` identifies a city tab by column A containing `PROJECT` and B
containing `BUILDER`; inserting at A makes B `PROJECT`, the tab stops being
recognised, and it vanishes from the Cities screen. Separately, `buildColMap_`
binds each field to the **first** header containing its keyword, so a `PROJECT ID`
column to the left of `PROJECT` would make every project name render as an ID.
Positions may differ per tab — matching is by header text, so appending is safe.

**Also confirmed:** the pricing tabs nothing in the app reads (`HotPriceSheet`,
`PRECON`, `HotDeals`, `Deposit Calculator`, `RESALE`) are **not** a usable source.
`HotPriceSheet` has prices but no project column at all; the others are 12–32 rows
keyed on free text.

---

## 2026-08-24 — `Audit.js`

Editor-only, read-only schema diagnostics: `auditCityHeaders()`,
`auditPriceTabs()`, `auditTabRows(tab)`. Nothing routed, nothing written.

**Why it exists.** The sheets are private and no available credential could read
them from outside — `clasp`'s OAuth scopes cover Apps Script and Drive *metadata*,
not sheet contents. Running the question inside the script was the way in.

Safe to delete once the sprint's discovery tickets close.
