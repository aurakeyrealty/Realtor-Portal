# Known issues

Found, understood, **not fixed**. Fixing everything the moment it is found stops
the build; writing it down badly means finding it twice.

One entry per defect. Each carries the symptom a realtor would see, the root
cause in the code, a command that reproduces it, and the fix I would write. If
an entry cannot be reproduced from a cold checkout, it is not finished.

**This is not the worklog.** [worklog.md](../worklog.md) says why the code is the
way it is. This says where it is still wrong.

When one is fixed: delete the entry, and put the reason in the worklog.

Status as of **2026-08-24**, against 161 projects (250 sheet rows, 87 dropped as
ONTARIO roll-up).

| # | Issue | Severity | Blast radius |
|---|---|---|---|
| [1](#1) | Dates parse day-first; the sheet is month-first | **High** | 10 of 23 dated projects |
| [2](#2) | Future dates count as recent changes | **High** | "what changed this week" |
| [3](#3) | An invented category returns silence, not an error | **High** | any type not in the four buckets |
| [4](#4) | `compare_projects` takes ids only, the model sends names | **High** | most comparisons |
| [5](#5) | 16 projects are unreachable by id | **High** | 16 of 161 |
| [6](#6) | The empty link column is sent, the filled one is not | Medium | 38 projects with a website |
| [7](#7) | Id lookup is case-sensitive | Low | `ak-0002` |
| [8](#8) | Benchmark expectations count duplicated rows | Medium | the benchmark's own credibility |

Data problems that are not code: [§ For Sudhanshu](#for-sudhanshu).

---

<a id="1"></a>
## 1. Dates parse day-first; the sheet is month-first

**Severity: High.** 10 of the 23 projects with a date are read wrong today.

**Symptom.** "What changed this week?" lists projects last touched in April as
though they changed in December. Occupancy and freshness answers inherit it.

**Root cause.** `_DATE_FORMATS` in `app/adapters/parsing.py` tries `%d/%m/%Y`
before `%m/%d/%Y`, and `parse_date` returns the first order that parses. Any
value whose day is 1-12 parses in both, so the wrong one wins.

The sheet is month-first, and it is not a judgement call — `08/24/2026`,
`10/25/2026` and `09/25/2025` have no valid day-first reading, and **no row in
the sheet parses day-first but not month-first**. The evidence is one-sided.

```
The Castlemile    04/12/2026   read as 2026-12-04   means 2026-04-12
Mayfield Village  05/11/2026   read as 2026-11-05   means 2026-05-11
MARI              06/10/2026   read as 2026-10-06   means 2026-06-10
```

The misreads land in the future, which is what put November and December rows at
the top of "what changed this week".

**Reproduce.**
```bash
cd aura-chat && .venv/bin/aura "What changed this week?"
```
Any date after today is a misread of this kind, except Harvest Park — see [#2](#2).

**Fix.** Put `%m/%d/%Y` first and delete `%d/%m/%Y`. Keeping both is a coin flip,
and the sheet has one convention. `parse_date`'s docstring claims the value is
"only ever shown to a realtor, never used to decide" — no longer true, since
`recent()` sorts on it. Update the docstring in the same change.

---

<a id="2"></a>
## 2. Future dates count as recent changes

**Severity: High.** Survives the fix for [#1](#1) — separate cause.

**Symptom.** Harvest Park appears in "what changed this week" every week.

**Root cause.** `ExecApiProjectRepo.recent` filters `last_updated >= today -
days` with no upper bound, and sorts descending — so a date in the future is not
merely included, it ranks first. Harvest Park is genuinely `10/25/2026`, two
months out. Reading it correctly does not stop it from being wrong.

**Reproduce.**
```bash
cd aura-chat && .venv/bin/aura "What changed this week?"
```

**Fix.** Exclude `last_updated > today` in `recent()`, and count the exclusions
so `/doctor` can report "1 project dated in the future". A typo in a date column
should be visible, not silently promoted to the top of the answer. The count is
the part that matters — dropping them silently trades a wrong answer for a
missing one.

---

<a id="3"></a>
## 3. An invented category returns silence, not an error

**Severity: High.** Aura denies that projects exist — **intermittently**, which
is worse than always.

**Symptom.** "Show me stacked townhomes." → *"I could not find any stacked
townhomes in our records."* There are five: NOMI, Flori, Northside, Orleans
(Summit Series), Westshore.

Asked again it answers correctly. Whether it fails depends on whether the model
invents a category that run, so the realtor gets a confident denial on one try
and the right answer on the next, with nothing to tell them which they got.

**Root cause.** `ProjectFilters.categories` is an unvalidated `list[str]`. The
portal's buckets are `detached, semi, townhome, condo`. The model called
`search_projects(categories=['stacked townhome'])`, `matches()` intersected that
with the real buckets, got nothing, and returned an empty page — which is
**indistinguishable from "the brokerage has none"**. Nothing anywhere says the
category was not real.

The same search with a valid filter finds all five, so the data and the matcher
are fine. The tool's contract is the defect.

**Reproduce — the defect, deterministically.** The tool accepts any string and
answers "none" to all of them:

```bash
cd aura-chat && .venv/bin/python - <<'EOF'
import asyncio, json, pathlib
from app.domain import ProjectFilters
from app.adapters.projects_exec import ExecApiProjectRepo
from app.adapters.portal_client import PortalClient

tok = json.loads((pathlib.Path.home() / ".aura/session.json").read_text())["token"]
url = open(".env").read().split("EXEC_URL=")[1].split("\n")[0].strip()

async def main():
    repo = ExecApiProjectRepo(PortalClient(url))
    for cats in (["stacked townhome"], ["townhouse"], ["townhome"]):
        page = await repo.search(ProjectFilters(categories=cats), auth=tok)
        print(f"{cats!r:24} -> total={page.total}")

asyncio.run(main())
EOF
```
```
['stacked townhome']     -> total=0
['townhouse']            -> total=0      <- a plausible synonym, silently empty
['townhome']             -> total=102
```

**Reproduce — the realtor-facing failure, unreliably.** `.venv/bin/aura --dev
"Show me stacked townhomes."` and watch the `search_projects(...)` line. When it
reads `categories=['stacked townhome']` the answer is a denial; when the model
picks `categories=['townhome'], query='stacked townhome'` it correctly finds all
five. Both happen. Do not read one good run as the issue being gone.

**Fix.** Validate `categories` against the four buckets and return
`unknown_categories: ['stacked townhome']` alongside the results, so an empty
page cannot mean two different things. Same principle as the truncation fix: a
tool must never let "you asked wrongly" look like "there are none". Free text
already searches `property_type`, so the model can recover on its own once it is
told.

---

<a id="4"></a>
## 4. `compare_projects` takes ids only, and the model sends names

**Severity: High.** Whether a comparison works is luck.

**Symptom.** "Compare Cornerstone and Reva Westfield." → *"I could not confirm
that from current records."* Both projects exist and both have ids.

**Root cause.** `tools.compare_projects` calls `repo.get(pid)`, which matches
`p.id` exactly. `get_project` resolves a name to an id first; `compare_projects`
does not, because that resolution lives inside `get_project` rather than
somewhere both can use. A realtor naming two projects is not handing over ids,
and the model passes what the realtor said.

**Reproduce.**
```bash
cd aura-chat && .venv/bin/aura --dev "Compare Cornerstone and Reva Westfield."
```
The dev line shows `compare_projects(project_ids=['Cornerstone', 'Reva Westfield'])`.

**Fix.** Lift the resolve-a-name step out of `get_project` into a shared helper
in `app/tools.py` and use it in both. An ambiguous name should return candidates
to choose from, exactly as `get_project` already does, rather than nothing.

---

<a id="5"></a>
## 5. 16 projects are unreachable by id

**Severity: High.** They can be found by search and then not opened.

**Symptom.** Six different Markham projects are all called UnionGlen. Five of
them cannot be retrieved, compared, or deep-linked — every request for any of
them returns the first.

**Root cause.** Only 29 of 161 rows carry a real PROJECT ID. The rest fall back
to `slugify(city, name)`, which is exactly two parts — so two projects with the
same name in the same city get the same id, and `get()` returns whichever the
sheet lists first.

```
markham:unionglen      6 projects
whitby:whitby-meadows  3
caledon:southcal       3
oakville:ivy-rogue     2   vaughan:new-kleinburg 2   pickering:new-seaton 2
```

10 ids covering 26 projects; **16 are shadowed**.

**Reproduce.** Search Markham, then ask about UnionGlen by any of its builders —
the same record comes back every time.

**Fix, in order of preference.**

1. **Sudhanshu fills PROJECT ID.** The real fix, and it is already underway. See
   the warning in [§ For Sudhanshu](#for-sudhanshu) about the ONTARIO tab: what
   id goes on a duplicated row decides whether de-duplication stays possible.
2. **Add the builder to the slug** — `markham:unionglen:fieldgate-homes`. Fixes
   most collisions today at the cost of another id that changes when a cell is
   edited. Six UnionGlens by six builders separate cleanly; six by one builder
   still collide.
3. **Fall back to the sheet's row number**, which is already in the payload and
   is unique. Stable only until rows are reordered.

Worth deciding before ids are minted, not after.

---

<a id="6"></a>
## 6. The empty link column is sent to the model, the filled one is not

**Severity: Medium.**

**Symptom.** "Which projects have a website I can send a client?" → *"I can't
determine which projects have a website."* 38 of 161 do.

**Root cause.** `_for_model` in `app/adapters/agent_pydantic.py` sends
`source: p.source_url`. `SOURCE URL` is empty on **all 161 rows**. `website_url`
is filled on **38** and is never sent. The model's refusal is honest about what
it was given and wrong about what exists.

`broker_url` (152 filled) is deliberately withheld — it is in `CLIENT_HIDDEN`,
and that is correct. `drive_url` (137) has not been considered either way.

**Reproduce.**
```bash
cd aura-chat && .venv/bin/aura "Which projects have a website I can send a client?"
```

**Fix.** Send `website_url`. Decide separately whether `drive_url` should reach a
realtor — it is internal material, so it is a policy question, not an oversight
to quietly correct.

---

<a id="7"></a>
## 7. Id lookup is case-sensitive

**Severity: Low.** No known realtor-facing failure; a realtor typing an id by
hand would hit it.

**Root cause.** `ExecApiProjectRepo.get` compares `p.id == project_id`. `ak-0002`
matches nothing.

**Fix.** Casefold both sides. One line, one test.

---

<a id="8"></a>
## 8. Benchmark expectations were written against duplicated data

**Severity: Medium** — it makes the benchmark's own verdicts untrustworthy.

**Symptom.** `benchmarks/questions.csv` expects counts that included ONTARIO
duplicates, so correct answers now fail and the score understates the system.

```
Q12  "around 10" stacked townhomes     really 5 (the other 5 were duplicates)
Q30  "Yes, 4" Ottawa projects          3 named + 1 row with an empty name
Q50  "38 of 246 carry a link"          38 of 161
```

Q07 and Q30 also check `cards>=N`, written before `inventory_summary` existed —
it answers counting questions correctly and returns no cards **by design**, so
the check now fails on the better answer.

**Root cause.** I derived the expectations by reading the sheet before the
duplicate tab was understood.

**Fix.** Re-derive every count against the live 161 and replace card-count checks
with content checks wherever a summary is now the right tool. Do this **last**,
after the fixes above — correcting checks against unfixed behaviour is how a
benchmark quietly becomes a description of the bugs.

---

<a id="for-sudhanshu"></a>
## For Sudhanshu — data, not code

No amount of code fixes these.

| What | Where | Why it matters |
|---|---|---|
| `09/31/2025` | Arbor West, Brampton | September has 30 days. Unparseable, so the project has no date at all. |
| `10/25/2026` | Harvest Park, Kitchener | Two months in the future. See [#2](#2). |
| `SOURCE URL` empty | all 161 | Nothing to cite. `WEBSITE URL` has 38 and is the usable one. |
| `DEPOSIT %` empty | every priced project | "Which have less than 10% deposit?" cannot be answered at all. |
| `PROJECT ID` empty | 132 of 161 | See [#5](#5). |
| The ONTARIO tab | 87 rows | **Decide before filling PROJECT ID.** If a duplicated row gets the *same* id as its city-tab row, de-duplication becomes possible. If it gets a *different* id, the two become formally distinct projects and the last clue that they are the same — the name — stops being enough. Different ids are worse than no ids. |
