# Remediation plan: security, clustering stability, canvas usability, doc truth

> **Status as of 2026-08-20 — Waves 0-2 complete, Waves 3-4 outstanding.**
> Suite is **743/743** on `main` @ `a5b7969`. See "Execution log" at the end for what each
> wave actually landed, including three items whose diagnosis in this plan proved wrong.
>
> | Wave | PRs | State |
> |---|---|---|
> | 0 | A (#105) | merged |
> | 1 | D (#106), C (#107), B (#108), E (#109), plus deflake (#110) | merged |
> | 2 | F (#111), G (#112) | merged |
> | 3 | H | not started |
> | 4 | I | not started |

## Context

`docs/review/comprehensive-review-2026-08-19.md` reviewed `main` @ `326b442` across design,
code quality, security, maintainability, intent fidelity, and end-product usability. It graded
the project B+ overall — the pipeline, the artifact DAG, and the API Flow view are genuinely
strong — but surfaced a set of concrete defects worth fixing.

Two findings from that review changed materially once the code was read closely during planning,
and this plan reflects the corrected version, not the review's original wording:

- **Canvas pan/zoom already exists.** `CanvasHost.tsx` has wheel-zoom (176-198), drag-pan
  (200-236), and `scaleRef` bounded 0.1–8 (34-36). The real defect is narrower than "no pan or
  zoom": line 104 sizes the container to the fitted bounds but never touches `scaleRef.current`,
  so a small scene renders at 100% in a large viewport. `docs/backlog/canvas-pan-zoom.md` is
  stale and overstates the gap.
- **The `.`-named group is deterministic, not LLM drift.** `checker.ts:29` and `pass-b.ts:14`
  assign `const dir = slash === -1 ? "." : ...`, so any root-level file produces a cluster
  literally named `.`. The fix belongs at the directory→cluster boundary, not only post-LLM.

Two further corrections: `tiles3d` is **185 LOC**, not the 1217 the review claimed (that number
was `docs/mock` Python). And README's "Flows" vs the UI's "API Flow" is **not** feature drift —
`store.ts:3` has mode key `flows` with display label `"API Flow"` (App.tsx:107), the same view
under two names; Flowchart is a genuinely separate deepest-zoom component (App.tsx:271, 342).
That item drops from "digression" to a one-word README touch-up.

**This plan supersedes `docs/plans/review-reconciliation-security-and-correctness.md`.** That plan
was written against `dc4fe57` and never executed — verified at `326b442`: risk-floor bypass still
present (`diff-with-risk.ts:51`), zero `lstatSync`/`realpath` in the extractor, `signature: null`
still hardcoded (`cli/src/snapshot.ts:23`), still Fastify 4. Only its step 9 partially landed
(`serve`/`ui` commands now exist). Its two BLOCKED items that the new review missed — extractor
symlink exfiltration and dependency CVEs — are absorbed here. Mark the old plan superseded rather
than deleting it; its reasoning is still the record of why these items matter.

**Threat model.** No auth component exists by design: single-user tool, run locally, server binds
`127.0.0.1` only (`cli/src/serve.ts:19`). Security items are robustness and defense-in-depth, not
live exposure. Two of them nonetheless violate the project's own written rule in `CLAUDE.md`
("Input validation via Zod / class-validator only — never trust raw request data").

**Sequencing.** The tracks below are organized by *theme*; the PR sequence at the end reorganizes
them by *dependency* into five waves, since several items across different tracks are independent
of each other and several within one track are not. The test-mock fix (2.4) runs first and alone —
it restores 13 currently-failing tests, and every later branch needs that green baseline. The
Fastify 5 CVE upgrade is an isolated PR and explicitly **non-blocking**: loopback-only binding
bounds the real risk, and it should not gate the UX and correctness work.

---

## Track 1 — Security (own PRs, land before UX work)

### 1.1 Server path traversal + unvalidated PUT body

**Landed in PR #108 (Wave 1, B).**

**Files:** `packages/server/src/store.ts`, `packages/server/src/app.ts`, `packages/schema/src/index.ts`

Confirmed exploitable over real HTTP during review: `GET /api/layout/..%2F..%2Foutside%2Fleak/plain`
returned file contents. Percent-encoded traversal survives Fastify's normalization; only literal
`../` is stripped. `saveLayout` will `mkdirSync` + write JSON anywhere the process can reach.
`PUT /api/layout/:sha/:skin` types its body `Body: Layout` — a **compile-time-only** assertion —
and persists whatever JSON arrives.

- Add `LayoutSchema` to `packages/schema/src/index.ts`. It does not exist there today; `Layout`
  is declared locally at `store.ts:5-7` as `{ nodeX: Record<string, number> }`. Constrain values
  to finite numbers and bound the key count.
- Validate route params before any path join: `sha` against a hex-SHA pattern, `skin` against a
  known-skin allowlist. Reject with **400**, not 404 — a rejected traversal is a bad request, and
  404 hides the distinction from tests.
- Defense in depth: `path.resolve` the joined path and assert it stays under the intended
  directory (`layoutsDir`/`snapshotsDir`/`deltasDir`) before read or write.
- `LayoutSchema.parse(req.body)` in the PUT handler.
- Apply the same param validation to `/api/delta/:from/:to` and `/api/snapshot/:sha`, which
  interpolate identically.

**Tests** — extend `packages/server/test/app.test.ts` and `store.test.ts` (both exist; a layout
round-trip test is already at `app.test.ts:159-180` to model style). Cover: percent-encoded
traversal → 400; literal `../` → 400; absolute path → 400; malformed PUT body → 400; the existing
round-trip still passes.

### 1.2 Extractor symlink containment

**Landed in PR #107 (Wave 1, C).**

**Files:** `packages/extractor/src/host.ts:20`, `packages/extractor/src/manifest.ts:25`

Both walkers use `statSync`, which follows symlinks, so a symlinked directory inside an analyzed
repo returns `isDirectory() === true` and is pushed onto the walk stack — pulling outside files
into the unit set, whose source is then sent to the provider when `anthropic` is selected.

Note: this was **confirmed by code reading, not executed** — the empirical probe was blocked under
plan mode. First implementation step is to reproduce it with a symlink fixture, then fix.

- Switch to `lstatSync` to detect links without following.
- Skip symlinks by default (matches the documented local-first posture).
- Add a `realpath` containment check so a resolved target outside the repo root is excluded.

**Tests** — new fixture under `packages/extractor/test/fixtures/` with a symlinked file and a
symlinked directory; assert both are absent from the unit set. `packages/extractor/test/` already
has 9 suites to match style.

### 1.3 Runtime validation at deserialization boundaries

**Landed in PR #108 (Wave 1, B).**

**Files:** `packages/server/src/store.ts:46,101,111`, `packages/cli/src/diff.ts:25`,
`packages/interpreter/src/config.ts:21`, `packages/cli/src/artifacts.ts:81`

`SnapshotSchema` (index.ts:204) and `DeltaSchema` (305) exist and are exported but are never
`.parse()`d — every read is `JSON.parse(...) as T`. A schema never parsed at a trust boundary is
documentation, not a contract; a truncated snapshot currently fails deep in the UI instead of at
the read.

- `SnapshotSchema.parse` / `DeltaSchema.parse` at each store read and at `cli/src/diff.ts:25`.
- Add a Zod schema for `InterpreterConfig` (interface at `config.ts:5-10`; no schema exists) and
  parse the YAML instead of casting.
- Fail with a message naming the offending file and the Zod issue path.

**Perf caveat:** `readAll()` (`store.ts:37`) already re-parses every snapshot on every call.
Adding `.parse()` there multiplies that cost. Do **1.4 first**, or fold them into one PR.

### 1.4 Memoize `Store.readAll()`

**Landed in PR #108 (Wave 1, B).**

**File:** `packages/server/src/store.ts:37`

The class doc-comment claims it "serves them in memory"; it does not — it re-reads and re-parses
the whole snapshot directory on every `listRevs`/`getSnapshot` call (~4.6MB, measured 22/12/24ms;
linear in history). Memoize keyed on directory mtime + entry count, or correct the comment. This
is a prerequisite for 1.3 being cheap.

### 1.5 Dependency CVEs — Fastify 5 (own PR, **non-blocking**)

**Landed in PR #109 (Wave 1, E).**
`npm audit --omit=dev`: **6 vulnerabilities (4 high, 2 critical)** across `fastify@4.29.1`
(`fast-uri`, `find-my-way`) and `undici` — the undici set has grown since the superseded plan was
written. Only fix is Fastify 4→5, breaking, and also requires `@fastify/http-proxy` 11.

Isolate as its own PR: upgrade, run full build + test, fix breakage, re-run audit clean. Explicitly
**not gating** the rest of this plan, per the loopback-only threat model.

---

## Track 2 — Correctness

### 2.1 Deterministic group-name normalizer

**Landed in PR #111 (Wave 2, F).**

**Files:** `packages/interpreter/src/checker.ts`, `pass-b.ts`, `pass-c.ts`

The naming constraint is **prompt-only** (`pass-c-groups.ts:36`, `pass-b.ts:69` — both ban "core",
"domain", "cluster", "layer", "module", "component", "even as a suffix"), with zero deterministic
enforcement; `pass-c.ts` imports only *types* from the checker. Committed fixture output at
`fixtures/orderly/.scv/artifacts/bc3450f.../groups.json` shows the violation: `api_layer`,
`app_layer`, `src_layer`, plus a group named `.`. Across runs the same repo produced kebab-case,
snake_case, and banned-suffix names. This is the design doc's own #1 principal risk, realized.

Extend `checkAndRepairClusters` in `checker.ts` — it already owns deterministic renaming (the
`${name}_group` collision fix at 76-83), so this is a hook to extend, not a new subsystem:

- Strip banned architecture-speak suffixes (`_layer`, `_cluster`, `_module`, `_component`, …).
- Canonicalize to one case convention (pick snake_case or kebab-case and enforce repo-wide).
- Replace `.` with a real name (e.g. `root`) — fix at the `directoryClusters` source
  (`checker.ts:29`, `pass-b.ts:14`) so it never enters the pipeline, not just at the tail.
- Preserve existing behavior: name-equals-member collisions must still be broken, and
  normalization must not create new collisions — re-run the collision pass after renaming.
- Set the existing `repaired` flag when normalization fires, so it stays observable.

**Tests** — `packages/interpreter/test/checker.test.ts` exists. Cover: each banned suffix stripped;
mixed-case input canonicalized; `.` renamed; normalization-induced collision resolved; `repaired`
set. Use the existing `fakeProvider(response)` pattern from `pass-b.test.ts:20-26`.

### 2.2 Surface the modularity score

**Landed in PR #111 (Wave 2, F).**

**Files:** `packages/interpreter/src/pass-b.ts:111-112`, `orchestrate.ts:489`, `cli`

`runPassB` already computes and returns `modularity` and `directoryModularity` in `PassBResult`
(interface at pass-b.ts:21-26) — and both are discarded at the call site. `docs/design.md`
promises "report a modularity score against the directory baseline" as the mitigation for the
clustering-instability risk. It is 90% built and 0% delivered.

Thread both values from `runLayersPass` (`orchestrate.ts:442-541`, result interface at 430-439)
out to the CLI and log them at analyze time — LLM clustering vs. directory baseline, so a
regression in clustering quality is visible rather than silent. Snapshot persistence is optional;
the CLI line delivers the mitigation.

### 2.3 Risk-floor bypass

**Landed in PR #106 (Wave 1, D).**

**File:** `packages/differ/src/diff-with-risk.ts:51`

`score: passD.score` lets Pass D *lower* the deterministic floor; `docs/design.md:175-181` says it
may only raise it. Fix to `Math.max(passD.score, delta.risk.formula_floor)`. Existing test at
`diff-with-risk.test.ts:56-75` asserts override but not floor preservation — extend it.

### 2.4 Stale test mock — the 13 failures

**Landed in PR #105 (Wave 0, A).**

**File:** `packages/cli/test/analyze.test.ts`

Commit `bd8e074` rewrote the Pass B and Pass C-groups prompts and response schemas; the mock's
dispatch substrings were never updated. **Both** are stale:

| mock matcher (line) | actual prompt text |
|---|---|
| `"grouping the files"` (31) | `"You are grouping a codebase's directories into named modules/layers…"` (pass-b.ts:56) |
| `"grouping a codebase's architectural layers"` (40) | `"You are proposing merges of a codebase's architectural layers…"` (pass-c-groups.ts:21) |

Neither matches, so both fall through to the catch-all `return passAResponse` (line 50); Pass B
then receives Pass A's `ports`/`cost` and fails `MergesMapSchema`. Verified during review: patching
the two matchers and their response shapes to `{merges:{}}` made all 15 tests pass.

- Fix both matchers and both response shapes.
- **Make `fakeProvider` throw on an unrecognized prompt** instead of falling through. The catch-all
  is what converted a stale mock into a confusing schema error three passes downstream.
- Lines 177-188 filter on the same two stale strings, so those assertions aren't measuring what
  they claim — update them too.
- Consider a shared dispatch table keyed on the 10 distinctive prompt openings (pass-a,
  pass-a-blocks, pass-b, pass-c, pass-c-groups, pass-c-flows ×2, pass-d, pass-docs, rank) so
  future prompt edits fail loudly at one place.

### 2.5 Differ's unemitted delta kinds

**Landed in PR #112 (Wave 2, G) — but the diagnosis below is wrong.** `risk_changed` was
not a dead *UI* branch. The differ never emitted the status at all, so deleting or fixing
the UI branch would have changed nothing. `classify()` sees only two units, while exposure
is a property of the surrounding graph, and the delta loop dropped unchanged units before
blast radius was computed. Fixed in the differ, not the UI. See "Execution log".

**Files:** `packages/differ/src/diff.ts`, `packages/schema/src/index.ts:258-266`, `packages/ui/src/CanvasHost.tsx:59`

Schema allows `added`/`removed`/`moved`/`renamed`/`modified`/`risk_changed`/`unchanged`; the
differ emits only `removed`(36), `added`(37), `unchanged`(51), `modified`(59). `risk_changed` has
a **dead UI branch** at `CanvasHost.tsx:59` that can never be reached; `moved`/`renamed` have no
UI handling at all.

Decide per kind rather than in bulk — `risk_changed` is cheap and meaningful (Pass D score crossed
a threshold with no structural change) and pairs naturally with 2.3; `moved`/`renamed` need
rename-detection heuristics and are real scope. **Recommendation:** implement `risk_changed`,
remove `moved`/`renamed` from the schema enum until there's a differ that emits them. Do not leave
all three as-is — schema and UI currently promise capability that does not exist.

---

## Track 3 — Usability

### 3.1 Fit-to-content on canvas load

**Landed in PR #112 (Wave 2, G) — but the root cause below is wrong.** The missing
`scaleRef.current` assignment is real but not sufficient: there was **no transform layer in
the render tree at all**, so scale only ever resized the container while its contents stayed
fixed. The prescription is also wrong twice over — the fit cannot run during render (the
scroll container is unmeasurable on first paint), and `fittedSceneRef`'s identity check does
*not* preserve user zoom. See "Execution log".

**File:** `packages/ui/src/CanvasHost.tsx:97-105`

The single worst product defect: ~97% empty canvas on the fixture repo. Root cause is precise —
line 104 does `setRenderSize({ w: base.w * scaleRef.current, ... })` but never updates
`scaleRef.current`, which stays at its initial `1`.

`sceneBounds()` (65-73, already returns a padded `ViewBox`) and `fittedSceneRef` (98) are already
in place. Add a fit-scale computation in that same block: derive `scale` from the scroll
container's client dimensions vs. `base.w`/`base.h`, clamp to the existing `MIN_SCALE`/`MAX_SCALE`
(34-36), assign `scaleRef.current`, then size and center via `scrollLeft`/`scrollTop`.

Constraints: cap at 1 so tiny scenes don't balloon; re-fit on scene change (drill/ascend/Back) but
**not** after a user zoom — the existing `fittedSceneRef` identity check already gives this;
viewport may be 0×0 on first paint, so guard and re-fit on resize.

**Tests** — `packages/ui/test/CanvasHost.test.tsx` exists and already has a re-fit test at :196.
Add: small scene scales up to fill; large scene scales down within `MIN_SCALE`; user zoom survives
a re-render; degenerate empty scene doesn't divide by zero.

### 3.2 Label truncation and clipping
**Files:** `packages/skins/tiles/src/node.ts:9-14,47,62`, Legend component

`fitLabel()` estimates width as `fontSize * CHAR_WIDTH_RATIO` with `CHAR_WIDTH_RATIO = 0.55`,
which over-truncates (observed: `fastapi 0…`). Full name is already preserved in an SVG `<title>`
(53-57), so hover recovery works — the defect is purely the aggressive estimate.

Calibrate the ratio against the actual rendered face, or measure once via canvas `measureText` and
cache. 3.1 also reduces this on its own by raising effective scale. Fix the clipped Legend
(`packages/ui/test/Legend.test.tsx` exists) in the same PR.

### 3.3 API Flow right-edge clipping
**Files:** `packages/ui/src/Flows.tsx:158-159`, `packages/ui/src/App.tsx:319,344-346`

The best view in the product is the one being cut off. The Inspector is a flex **sibling** with
`flex: none`, so it squeezes `Flows`. `div.flows-path` has `minWidth: 0` (158) but `GraphCanvas`
(159) appears not to — the standard flex-overflow fix. Verify with a long flow.

### 3.4 "ENTRY POINTS" header in Depends-on mode
**File:** `packages/ui/src/App.tsx:330-335`

`<Tray title="Entry Points">` wraps `EntryPointsRail` in Depends-on mode, where the content is
external dependencies, not API entry routes (Flows.tsx:123 uses the same label correctly). Retitle
for the depends case.

### 3.5 Delta empty state
**File:** `packages/ui/src/InspectQueue.tsx:16-47`

"No delta available for this revision." renders *alongside* a normally-rendered graph, which reads
as contradictory. The message placement in the tray is intentional for layout stability — so the
fix is in how Delta mode presents the canvas when `entries.length === 0`, not an early return in
`InspectQueue`. Make the empty state explicit.

---

## Track 4 — Documentation truth

### 4.1 `CLAUDE.md` + `AGENTS.md` structure line
Both files state `**Structure:** `/src · /tests · /docs`` at **line 5** — identical text, two
files (`AGENTS.md` is a regular file, not a symlink, so both need editing). The repo is a
`/packages` npm-workspace monorepo with no top-level `/src` or `/tests`. This is the first thing
every agent and contributor reads. One-line fix, highest value-per-character in the plan.

### 4.2 Stale backlog reconciliation
`docs/backlog/canvas-pan-zoom.md` states "CanvasHost has no pan or zoom — the graph renders at
fixed scale/position." **Both already exist** (wheel-zoom 176-198, drag-pan 200-236). Rewrite to
the actual remaining gap — no initial fit-to-content — and close it when 3.1 lands. Also check the
"left-to-right layout axis change" it references as still outstanding.

### 4.3 README accuracy
- Status table marks every package "Implemented"; true at package granularity, misleading given
  `tiles3d` unwired and three delta kinds unemitted. Qualify those two rows.
- Align "Flows" with the shipped "API Flow" label — cosmetic wording only, same view (see Context).
- Keep the A6 section's candor as-is; it is a genuine asset.

### 4.4 `tiles3d` decision
`packages/skins/tiles3d` is **185 LOC** (not 1217 — review erratum) and unreferenced by
`packages/ui` and `packages/cli`. Small enough that archiving is not urgent, but it should not sit
in an ambiguous state: either wire it behind a skin switch or move it out with a note. Owner's
call; plan records the decision point.

### 4.5 Mark the superseded plan
Add a header to `docs/plans/review-reconciliation-security-and-correctness.md` pointing here.

---

## PR sequence — parallelized into waves

Nine PRs in five waves rather than ten sequential steps. Two structural changes make the
parallelism safe, and both are improvements on their own:

- **1.4 and 1.3 and 1.1 merge into one server PR.** All three rewrite `Store` methods in
  `packages/server/src/store.ts`; splitting them guarantees a conflict for no review benefit.
  1.3's note already said "do 1.4 first, or fold them into one PR" — fold.
- **2.5 moves out of the risk PR and into the canvas PR.** Its UI half deletes the dead
  `risk_changed` branch at `CanvasHost.tsx:59`, the same file 3.1 rewrites. Landing them
  separately means one rebases onto the other. 2.3 (risk floor, `diff-with-risk.ts` only) stays
  independent and ships in Wave 1.

### Wave 0 — unblock the suite (alone) — **merged**

| PR | Contents | Files |
|---|---|---|
| A | 2.4 test mock + throwing `fakeProvider` | `packages/cli/test/analyze.test.ts` |

Runs alone and first. The suite is currently **673 passing / 13 failing**; every branch in later
waves needs a green baseline to verify against, or four concurrent branches each have to
distinguish their own regressions from the pre-existing 13. This PR is test-file-only, so it is
fast to review and carries no product risk. After it lands the baseline is **686/686**.

### Wave 1 — four concurrent branches (disjoint files) — **merged**

| PR | Contents | Primary files |
|---|---|---|
| B | 1.1 + 1.3 + 1.4 server hardening | `server/src/store.ts`, `server/src/app.ts`, `schema/src/index.ts` |
| C | 1.2 extractor symlink containment (reproduce first) | `extractor/src/host.ts`, `manifest.ts` |
| D | 2.3 risk floor | `differ/src/diff-with-risk.ts` |
| E | 1.5 Fastify 5 CVE upgrade | `package.json`, lockfile |

B and E both concern the server but touch disjoint files — E is dependency/lockfile plus whatever
Fastify 5 breaks, B is route and store logic. They can be developed in parallel. **They must not be
merged back to back without re-running the second one's tests against the first's merge**: E is a
breaking major upgrade to the framework B is hardening, and a Fastify 5 change to route param
handling or error serialization could silently alter B's new 400 responses. Whichever lands
second rebases and re-verifies before merge.

B also carries `schema/src/index.ts` (adding `LayoutSchema`). Wave 2's PR G touches the same file
if 2.5 drops `moved`/`renamed` from the delta-kind enum — different region, small conflict risk,
resolved by landing B first (it is in the earlier wave regardless).

### Wave 2 — two concurrent branches — **merged**

| PR | Contents | Primary files |
|---|---|---|
| F | 2.1 name normalizer + 2.2 modularity surfacing | `interpreter/src/checker.ts`, `pass-b.ts`, `orchestrate.ts` |
| G | 3.1 fit-to-content + 2.5 `risk_changed` / drop `moved`+`renamed` | `ui/src/CanvasHost.tsx`, `differ/src/diff.ts`, `schema/src/index.ts` |

Interpreter vs. UI+differ — no shared files. G is the biggest UX win in the plan and the one worth
screenshotting before and after.

### Wave 3 — depends on G — **not started**

| PR | Contents |
|---|---|
| H | 3.2–3.5 label truncation, legend, API Flow clipping, Depends-on header, Delta empty state |

Sequenced after G rather than beside it: 3.1 raises the effective canvas scale, which changes how
much 3.2's `CHAR_WIDTH_RATIO` actually over-truncates. Calibrating the ratio against the
pre-fit scale would mean re-tuning it immediately afterward.

### Wave 4 — depends on all of the above — **not started**

| PR | Contents |
|---|---|
| I | 4.1–4.5 docs, backlog reconciliation, README, tiles3d decision, mark superseded plan |

Last by necessity, not convention: 4.2 rewrites the backlog item to describe the gap **as 3.1
closed it**, and 4.3 qualifies the README status rows for the delta kinds **as 2.5 resolved them**.
Writing either before the code lands means writing it twice. 4.1 (the `/src · /tests · /docs`
line in `CLAUDE.md` and `AGENTS.md`) is independent of everything and can be pulled forward into
any wave if you want the highest value-per-character fix in early.

### Critical path

Wave 0 → Wave 1 → Wave 2 → Wave 3 → Wave 4 = **five sequential steps**, with a maximum of four
branches open at once. If only one branch can be in flight at a time, the same nine PRs run in the
order A, B, C, D, E, F, G, H, I.

Per `CLAUDE.md`: branch → implement → verify → review → push → PR → merge; never commit to main.
TDD RED-GREEN-Refactor — failing test before implementation on every code item above. With
concurrent branches, each rebases on `main` and re-runs `npm test` immediately before merge — a
green check from before a sibling landed is not evidence.

---

## Verification

**Per PR:** `npm run lint`, `npm run build`, `npm test` — all clean. Baseline is 673 passing / 13
failing; after PR A the suite should be **686/686**, and no later PR may reduce it. Concurrent
branches rebase on `main` and re-run the suite immediately before merge.

**Security (PRs B, C, E):**
- Re-run the raw-socket traversal probe: `GET /api/layout/..%2F..%2Foutside%2Fleak/plain` must
  return **400**, not file contents. (Raw socket matters — a normalizing HTTP client masks it.)
- Malformed `PUT /api/layout/:sha/:skin` body → 400, nothing written to disk.
- Symlink fixture: symlinked file and dir both absent from the unit set.
- `npm audit --omit=dev` clean after PR E.

**Clustering (PR F):** re-run analyze against `fixtures/orderly` and confirm `groups.json` contains
no `_layer`/`_cluster` suffixes, no group named `.`, and one consistent case convention. Run twice
and diff the group names — the point of the mitigation is run-to-run stability. Confirm the
modularity line appears in CLI output.

**UI (PRs G, H):** `scv serve` + `scv ui` against `fixtures/orderly`, then Playwright across all
four views (Current / Delta / API Flow / Depends on), drill-down, and both skins. Screenshot
before/after for 3.1 — the fixture scene should fill the viewport instead of occupying a corner.
Assert **zero console errors** (the current baseline is zero; do not regress it). Confirm no tile
labeled `.`, legend fully visible, API Flow not clipped at the right edge.

**Constraint:** use `ollama` or fixtures for any analyze run — **not `claude-cli`**.

---

## Addendum — intermittent `cached-provider` test failure (found during Wave 1)

While re-verifying PR E (Fastify 5) against the merged PR B, the full suite failed once with:

```
FAIL |@scv/interpreter| test/cached-provider.test.ts > CachedProvider
  > logs durationMs on the per-call row for both a real call and a cache hit
```

**Not a Fastify regression.** The file has no HTTP dependency, and the same test passes 14/14 in
isolation. Across three consecutive full-suite runs on the rebased branch it failed once and
passed twice — intermittent, and reproducible on `main` for the same reason.

**Cause.** The test sleeps `setTimeout(resolve, 10)` and asserts
`expect(calls[0]!.durationMs).toBeGreaterThanOrEqual(10)`. `cached-provider.ts:52` computes
`durationMs = Math.round(performance.now() - startedAt)`. Node's timer delay is not a guaranteed
lower bound, so under full-suite parallel load the callback can fire at ~9.5ms; `Math.round` then
yields `9` and the assertion trips. The threshold is measuring the scheduler, not the code.

**Fix (own PR, not folded into E).** The assertion's actual intent is "a real call records a
nonzero duration, a cache hit records zero" — the 10ms figure is incidental. Drop the sleep-
coupled bound to `toBeGreaterThanOrEqual(1)`, keeping `calls[1]` (the cache hit) asserted at `0`
via the existing `cacheHit: true` path, which logs `durationMs: 0` unconditionally
(`cached-provider.ts:45`). That keeps both halves of the claim under test without depending on
timer precision.


---

## Execution log — Waves 0-2

Recorded after the fact, because three items in this plan were diagnosed incorrectly during
planning and the corrected diagnosis is the useful part of the record. The plan's own Context
section already corrected two review findings; these are the ones the *plan* got wrong.

### Where this plan was wrong

**1. Item 3.1 — the canvas defect was a missing layer, not a missing assignment.**

The plan states the root cause "is precise": line 104 sizes the container but "never updates
`scaleRef.current`, which stays at its initial `1`". That is a real bug, and it is not the
whole one. There was **no transform layer in the render tree at all**. `scaleRef` fed the
container's width and height and nothing else, so both the wheel zoom and the missing fit were
resizing the outer box while its contents stayed at fixed size. Assigning `scaleRef.current` as
the plan describes would have made the box the right size and left the graph unscaled inside it.

The fix therefore restructures the render into two layers rather than adding one assignment,
because scrolling and scaling need *different* sizes: `.canvas-extent` carries the scrolled
extent (scene x scale, which is what produces real scrollbars) and `.canvas-scale` stays at raw
scene dimensions and is `transform: scale()`d, so nodes keep their scene coordinates.

Two further corrections to that item's prescription:

- It says to compute the fit "in that same block" — i.e. during render. That cannot work:
  during the first render `scrollRef.current` is still `null`, so every measured dimension reads
  0 and the fit silently returns 1. The fit has to run in a `useLayoutEffect`, after the DOM
  exists and before paint.
- It says "the existing `fittedSceneRef` identity check already gives this" for preserving user
  zoom across re-renders. It does not. `buildScene` returns a fresh object whenever the parent
  passes a new `edges` array literal, which is every render — so an identity check re-fits
  constantly and discards the user's zoom. The effect keys on scene *bounds* instead. One of the
  new tests caught this; it is not a theoretical concern.

**2. Item 2.5 — `risk_changed` was unemittable, not merely unrendered.**

The plan calls it a "**dead UI branch** at `CanvasHost.tsx:59` that can never be reached" and
scopes the UI half of the work to deleting that branch. The branch is not separately dead — it
is folded into a combined condition with `modified`/`rollup`, and it was unreachable for a
reason upstream of the UI: **the differ never emitted the status**, so no amount of UI work
would have changed anything.

The reason it could not be emitted is structural. `classify()` sees only two units, but exposure
is a property of the *surrounding graph*, and the delta loop discarded unchanged units before
blast radius was ever computed. The fix adds `exposureChanged()` and moves the blast-radius
computation above the unchanged-skip. `amount` stays 0 for the new status, so the risk floor
does too — a unit becoming more exposed is not evidence that its own code became likelier to
break.

**3. Item 2.5's file list points at the wrong `schema/src/index.ts` line range.**

Cited as `packages/schema/src/index.ts:258-266`. By the time Wave 2 ran, PR #108 had added
`LayoutSchema` to that file and shifted the enum. The plan's Wave 1 note anticipated the
conflict risk and was right to; only the line numbers went stale.

### What landed

| Wave | PR | Items | Notes |
|---|---|---|---|
| 0 | #105 | 2.4 | Restored the 13 failing tests; baseline 686/686 as predicted. |
| 1 | #106 | 2.3 | Risk floor. |
| 1 | #107 | 1.2 | Symlink containment; the exploit was reproduced with a fixture first, as the item required. |
| 1 | #108 | 1.1 + 1.3 + 1.4 | Server hardening, folded per the plan. |
| 1 | #109 | 1.5 | Fastify 5; `npm audit --omit=dev` clean. |
| 1 | #110 | — | Not in the plan: deflaked `cached-provider` duration assertions, per the addendum above. |
| 2 | #111 | 2.1 + 2.2 | Cluster-name normalizer and modularity surfacing. |
| 2 | #112 | 3.1 + 2.5 | Canvas fit-to-content, `risk_changed`, `moved`/`renamed` dropped from the enum. |

Suite grew 673 -> **743** across the seven PRs; `main` @ `a5b7969`, lint and build clean. Every
PR was reviewed via the `project-review` skill in a fresh subagent with the verdict posted to
the PR itself before merge.

### Verification notes worth keeping

- **The 1440x900 before/after screenshots for 3.1 look nearly identical, and that is correct.**
  The plan's verification step expects "the fixture scene should fill the viewport instead of
  occupying a corner". It does not, because the fit is capped at 1 by design — a six-node
  fixture graph is not blown up to fill a large screen. Scale-*down* was verified separately at
  700x500, where the full graph becomes visible instead of clipped. Anyone re-running this check
  at a large viewport should not read the unchanged screenshot as a failure.
- Three guards in the fit logic were sabotage-tested (fit always returns 1; no 1:1 cap; no
  zero-viewport guard). Each failed exactly one test, so none are decorative.
- Playwright across all four views: zero console errors, zero warnings.

### Still open for Wave 3

Two defects observed during PR G's verification are **already covered** by Wave 3 and were left
alone deliberately: API Flow right-edge clipping (item 3.3) and side panels squeezing the canvas
at narrow widths — the same flex issue, and the same fix.
