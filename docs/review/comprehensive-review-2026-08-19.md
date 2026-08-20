# semantic_viz — Comprehensive Review

> **Resolution status (added 2026-08-20, at commit `650e5d5`).** This review was executed
> as the remediation plan in `docs/plans/remediation-security-clustering-canvas-docs.md`,
> Waves 0-4 (PRs #105-#115). The body below is the review **as written on 2026-08-19** and
> is deliberately not retro-edited — it records what was true at `326b442`.
>
> Every finding in §10's priority list is closed except #8, which was re-scoped:
>
> | # | Finding | Status at `650e5d5` |
> |---|---|---|
> | 1 | Canvas fit-to-content (U1) | ✅ `CanvasHost.tsx` fits the scene on scene-identity change |
> | 2 | Deterministic group-name normalizer (D3, U2) | ✅ `interpreter/src/checker.ts:53` `normalizeClusterName`, with collision merge |
> | 3 | Validate server boundaries (S1, S2) | ✅ closed more strongly than proposed — see note below |
> | 4 | `fakeProvider` stale prompt matchers (§8) | ✅ PR #105; suite green |
> | 5 | `CLAUDE.md` / `AGENTS.md` structure line (G1) | ✅ Wave 4 |
> | 6 | Surface modularity (D2) | ✅ `orchestrate.ts:935` logs `modularity=` against `directory_baseline=` |
> | 7 | `Store.readAll()` memo or comment (§4) | ✅ Wave 1 |
> | 8 | Decide `tiles3d`'s fate (G4) | ⏳ **open** — scoped as Wave 5; see note below |
> | 9 | `SnapshotSchema.parse` at read boundaries (D1/S3) | ✅ `parseOrThrow` in `server/src/store.ts` |
> | 10 | README view names, unemitted delta kinds (G2, G5) | ✅ `risk_changed` now emitted (`differ/src/diff.ts:169`) |
>
> **On S1/S2 (§5).** The fix is not the `SAFE` regex this review proposed. `Store` resolves
> every path through a `containedPath` helper that rejects anything escaping the target
> directory, with a `rejectUnsafe` guard on the routes; the `PUT` body goes through
> `LayoutSchema.safeParse` and returns 400 rather than throwing. Containment is the stronger
> control — it holds for inputs a character-class regex would admit.
>
> **On G4 (§7) — the one open item.** This review, and the plan's item 4.4, both assumed
> `tiles3d` could be wired behind a config toggle. That premise was wrong: `CanvasHost` never
> calls `Skin` at all, and the two `Skin` types in `skins/tiles` and `skins/tiles3d` have
> incompatible return types, so there is no seam to toggle. Making the skin contract real is
> scoped as **Wave 5** in the remediation plan and is a capability change, not a defect fix —
> archiving `tiles3d` remains the cheaper alternative. The decision is open.
>
> Five further items had their **diagnosis** corrected during execution while the finding
> itself stood; the plan's execution logs record each one.

**Date:** 2026-08-19
**Reviewed at:** `main` @ `326b442`
**Scope:** design · code quality · security · maintainability · digressions from original intent · quality & usability of the end product
**Method:** full-repo read, `npm run build` / `npm test` / `npm run lint`, live UI exercised via Playwright against `fixtures/orderly`, targeted HTTP probes against `scv serve`. No `claude-cli` used. **No source files were modified.**

**Threat model (per project owner):** there is no auth component by design. This is a **single-user tool run locally on one's own computer**; the server binds `127.0.0.1` only. Every security finding below is graded against that model, not against a multi-tenant or internet-exposed one.

---

## 1. Verdict

**Strong engineering, real product thesis, shipping-quality core — with a small number of concrete defects worth fixing.**

The pipeline (Extractor → SymbolGraph → Interpreter → Snapshot → Differ → DeltaGraph) is coherent, the `scv/1` schema is a genuine contract, the test suite is dense, and the **API Flow view is genuinely good** — it is the product delivering on its own thesis.

Three things hold it back:

1. **The `scv/1` schema is defined but never enforced at any runtime boundary.** Zod schemas exist and are exported; every read path is `JSON.parse(...) as T`.
2. **The design doc's own #1 principal risk — clustering instability — is real and unmitigated.** The promised mitigations (deterministic checker, modularity score reporting) are partly computed and entirely unsurfaced.
3. **The canvas has no fit-to-content.** This is the single largest usability defect: ~97% of the viewport is empty on the fixture repo.

| Area | Grade | One-line |
|---|---|---|
| Design | **B+** | Coherent pipeline and a real schema contract; promised mitigations unbuilt |
| Code quality | **A−** | 1 `any`, 0 TODO/FIXME in ~10k LOC, clean lint, dense tests |
| Security | **B** (localhost model) / D (if ever exposed) | Confirmed path traversal + unvalidated `PUT` body; bounded by loopback bind |
| Maintainability | **A−** | High test ratios, small focused modules; some doc drift |
| Intent fidelity | **B** | Core intent held; several documented-but-unbuilt and built-but-unwired items |
| End product | **B−** | API Flow excellent; canvas fit, label clipping, and a `.`-named tile hurt first impression |

---

## 2. Health check

| Check | Result |
|---|---|
| `npm run build` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm test` | ⚠️ **673 / 686 pass; 13 fail** — all in `packages/cli/test/analyze.test.ts`. Root cause in §8. Owner confirms these are routine/known. |
| Browser console errors | ✅ zero across all four views |
| `any` usages | ✅ 1 across the whole repo |
| `TODO` / `FIXME` | ✅ 0 |
| Tracked build artifacts / junk | ✅ none; `.gitignore` correct |
| Test-to-source file ratio | ✅ interpreter 27/31 · layout 10/11 |

---

## 3. Design

### What is right

- **The pipeline is the right decomposition.** Static extraction is deterministic and cacheable; only the *interpretation* is LLM-bound. This is the correct seam and it is honored — the extractor has no LLM dependency.
- **Three-hash design (`struct` / `text` / `semantic`)** is a genuinely good idea: it lets the cache invalidate on meaning-relevant change while ignoring formatting churn.
- **The artifact DAG** in `packages/cli/src/artifacts.ts` is the best-designed subsystem in the repo. `ARTIFACT_DEPENDENCIES` declares the graph, `computeInputHash` derives freshness per artifact, and the `force` set is carefully scoped — the doc comment on `ArtifactContext.force` (lines 66–69) explains precisely why forcing does not cascade upstream. Recomputation is minimal and correct.
- **`scv/1` as "the sole contract"** between analyzer and visualizer is the right architectural bet, and it does hold structurally.
- **2D-first with 3D as a skin, never a fork** — the right call, even though the 3D skin is currently unwired (§7).

### What is weak

**D1 — The contract is declared but never enforced.**
`packages/schema/src/index.ts` exports `SnapshotSchema` (204), `DeltaSchema` (305), `UnitSchema` (112). Every consumer bypasses them:

```ts
// packages/server/src/store.ts
JSON.parse(readFileSync(...)) as Snapshot
JSON.parse(raw) as Layout

// packages/cli/src/artifacts.ts:81
JSON.parse(readFileSync(file, "utf-8")) as StoredArtifact<T>

// packages/interpreter/src/config.ts:21
parse(readFileSync(...)) as { interpreter?: InterpreterConfig }   // YAML, cast not validated
```

A schema that is never `.parse()`d at a trust boundary is documentation, not a contract. A hand-edited or truncated snapshot fails deep inside the UI with an unhelpful error instead of at the read with a precise one. This is also a **direct violation of the project's own stated rule** in `CLAUDE.md`: *"Input validation via Zod / class-validator only — never trust raw request data."*

**D2 — The design doc's #1 principal risk is unmitigated.**
`docs/design.md` lists, under Principal risks:

> *"Interpreter clustering is unstable run to run → Deterministic checker plus cached decisions; recluster only when the import graph crosses a threshold; **report a modularity score against the directory baseline**."*

Status of each promised mitigation:

| Promised mitigation | Built? |
|---|---|
| Cached decisions | ✅ yes — content-addressed cache + artifact persistence |
| Deterministic checker | ⚠️ partial — Pass B repairs *membership*; **nothing repairs names** |
| Recluster only past a threshold | ❌ not implemented |
| Report modularity score vs. directory baseline | ❌ **computed and discarded** |

`packages/interpreter/src/pass-b.ts:111-112` computes both `modularity` and `directoryModularity` — and neither value is ever surfaced to the CLI, the snapshot, or the UI. The mitigation is 90% built and 0% delivered.

**D3 — Naming constraints are prompt-only.**
`packages/interpreter/src/prompts/pass-c-groups.ts:36` bans architecture-speak suffixes in group names:

> `Never include generic architecture-speak words in the name itself — "core", "domain", "cluster", "layer", "module", "component" — even as a suffix (e.g. "billing_cluster" is WRONG; use "billing")`

`packages/interpreter/src/pass-c.ts` imports only **types** from the checker — there is no deterministic post-hoc enforcement. The result is visible in committed fixture output, `fixtures/orderly/.scv/artifacts/bc3450f.../groups.json`:

| directory | assigned group |
|---|---|
| `api` | `api_layer` ❌ banned suffix |
| `app` | `app_layer` ❌ |
| `src` | `src_layer` ❌ |
| `src/db` | `src_layer` |
| `src/utils` | `src_layer` |
| `src/payments` | `app_layer` |
| `.` | **`.`** ❌ a group literally named `.` |

Across runs the same repo produced kebab-case (`extractor-core`), snake_case (`extractor_core`), and banned-suffix (`api_layer`) names. **A constraint enforced only in a prompt is a suggestion.** This is the concrete realization of D2 — instability is not hypothetical, it is in the checked-in fixture.

**Recommendation:** a ~20-line deterministic normalizer after Pass C-groups — strip banned suffixes, canonicalize case to one convention, reject/rename `.` — would close D3 entirely and is far cheaper than more prompt engineering.

---

## 4. Code quality

Genuinely high. Specifics worth calling out:

**Good:**
- `packages/cli/src/bin.ts` — clean top-level error handling, no stack-trace vomit:
  ```ts
  .catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
  ```
- SQL is parameterized throughout the cache layer.
- Subprocess invocation uses `spawnSync` with argv **arrays** — no shell string interpolation, so no shell injection surface.
- `packages/interpreter/src/pass-b.ts` accepts both response shapes defensively:
  `z.union([z.object({ merges: MergesMapSchema }), MergesMapSchema])` — sensible tolerance of LLM output variance.
- Naming is intent-revealing (`ensureArtifact`, `computeInputHash`, `parentOverride`), functions are small, dead code is absent.

**Blemishes:**

- **`packages/server/src/store.ts:37` `readAll()` re-reads and re-parses every snapshot on every call**, despite the class doc-comment claiming it *"serves them in memory."* `getSnapshot` (line 71) calls `readAll().find(...)`. Measured today: 22ms / 12ms / 24ms on a ~4.6MB corpus — fine now, **linear in history length** and the comment is actively misleading. A one-line memo keyed on directory mtime fixes both.
- `packages/cli/src/artifacts.ts:216` is clever-but-opaque:
  ```ts
  (map.get(file) ?? map.set(file, []).get(file)!).push(unit);
  ```
  The `!` and the `set().get()` round-trip earn nothing over a plain three-line if. Minor, but it is the one place readability was traded for terseness.
- `computeInputHash` is declared `async` but contains no `await` — harmless, slightly misleading.

---

## 5. Security

**Framing:** no auth component exists **by design** — single-user, local, loopback-bound. Findings are therefore about robustness and defense-in-depth, not about an exploitable production exposure. None of these are emergencies. All are cheap to fix and two of them violate the project's own written rules.

### S1 — Path traversal on `/api/layout/:sha/:skin` — **CONFIRMED over real HTTP**

`packages/server/src/store.ts` interpolates both route params straight into `path.join` with no validation:

```ts
getLayout(sha: string, skin: string): Layout | undefined {
  const raw = readFileSync(path.join(this.layoutsDir, `${sha}.${skin}.json`), "utf-8");
  return JSON.parse(raw) as Layout;
}
saveLayout(sha: string, skin: string, layout: Layout): void {
  if (!existsSync(this.layoutsDir)) mkdirSync(this.layoutsDir, { recursive: true });
  writeFileSync(path.join(this.layoutsDir, `${sha}.${skin}.json`), JSON.stringify(layout));
}
```

**Verification history (my own reasoning was wrong twice before I proved it):**
1. First assumed Fastify's URL normalization defeated it — a literal `../` request 404s. **Wrong conclusion, right observation.**
2. Then assumed the `.json` suffix template defeated it. **Also wrong** — a file named to match `<sha>.<skin>.json` satisfies the template.
3. Store-level probe with a matching filename: read returned `{"secret":"LEAKED"}`, and write escaped the `.scv` directory.
4. Raw TCP socket probe, bypassing client-side normalization:
   ```
   GET /api/layout/..%2F..%2Foutside%2Fleak/plain
   → {"secret":"LEAKED_OVER_HTTP"}
   ```

**Percent-encoded traversal survives; only literal `../` is normalized away.** Both read and write are affected — `saveLayout` will `mkdirSync` and write JSON anywhere the process can reach.

Impact under the stated threat model is genuinely low (loopback bind, single user, attacker would already need local code execution or to lure the user into a crafted link hitting `localhost`). But the fix is ~3 lines:

```ts
const SAFE = /^[A-Za-z0-9_-]+$/;
if (!SAFE.test(sha) || !SAFE.test(skin)) throw new Error("invalid layout key");
```

### S2 — `PUT /api/layout/:sha/:skin` persists a completely unvalidated body

```ts
app.put<{ Params: {...}; Body: Layout }>("/api/layout/:sha/:skin", async (req, reply) => {
  store.saveLayout(req.params.sha, req.params.skin, req.body);   // no Zod, no shape check
  return reply.code(204).send();
});
```

`Body: Layout` is a **compile-time-only** assertion. Any JSON — or a multi-megabyte blob — is written to disk verbatim and later read back and trusted by the UI. Combined with S1 this is arbitrary-JSON-write-to-arbitrary-path. Again: direct violation of `CLAUDE.md`'s *"Input validation via Zod / class-validator only — never trust raw request data."* A `LayoutSchema.parse(req.body)` closes it.

### S3 — No runtime validation on any deserialization boundary

Covered as D1. Security-relevant because artifact and snapshot files under `.scv/` are read back and trusted without checking; a corrupt or tampered artifact propagates into the UI unchecked.

### S4 — Config file cast, not validated

`packages/interpreter/src/config.ts:21` casts parsed YAML rather than validating it. Malformed config produces a confusing downstream failure rather than a clear one.

### What is done right

- ✅ **API key is environment-only.** `packages/interpreter/src/providers/anthropic.ts:27-37` reads `process.env.ANTHROPIC_API_KEY`, throws clearly if unset, sends it as `x-api-key`, and **never persists it** — not to config, not to cache, not to logs.
- ✅ **No secrets anywhere in source or comments.** Verified by sweep.
- ✅ **Parameterized SQL** throughout — no injection surface in the cache.
- ✅ **`spawnSync` with argv arrays** — no shell injection surface in the `claude-cli` provider.
- ✅ **Server binds `127.0.0.1` explicitly** (`packages/cli/src/serve.ts:19`) — this is the single control that keeps S1/S2 low-severity, and it is correct and deliberate.

### Priority

| # | Finding | Severity (stated model) | Fix cost |
|---|---|---|---|
| S1 | Path traversal, read + write | Low–Medium | ~3 lines |
| S2 | Unvalidated `PUT` body | Low–Medium | ~1 line |
| S3 | No boundary validation | Low | ~1 line per boundary |
| S4 | Config cast not validated | Low | ~5 lines |

---

## 6. Maintainability

**Strong.** Test-to-source ratios are excellent (interpreter 27/31, layout 10/11), modules are small and single-purpose, lint is clean, and the design-system migration is genuinely complete — `find packages/ui/src -name '*.css'` returns nothing, so there is no bespoke CSS competing with CodeDream tokens.

`docs/backlog/` and `docs/plans/` are a real asset. Backlog items carry Status / Found / Closed and, for closed ones, a written explanation of the actual fix and the affected packages. `docs/plans/README.md` documents *why* plans were migrated out of `~/.claude/plans/` (random slugs, silent overwrites). This is above-average project hygiene.

**Drag factors:**
- Documentation drift (§7) means new contributors are onboarded onto a structure that does not exist.
- `docs/review/` already holds `codex-review.md` and `project-review.md`; without dating or a status header, review documents accumulate without an obvious current one. (This file is dated for that reason.)
- The unwired `tiles3d` package (1217 LOC) is maintenance surface that returns nothing today.

---

## 7. Digressions from original intent

Core intent is intact: TypeScript end-to-end, 2D-first, semantic-not-syntactic, schema as contract. The digressions are peripheral but real.

| # | Documented intent | Actual state | Severity |
|---|---|---|---|
| G1 | `CLAUDE.md` / `AGENTS.md`: *"Structure: `/src · /tests · /docs`"* | Repo is a `/packages` npm-workspace monorepo. No top-level `/src` or `/tests`. | **High** — this is the file agents and contributors read first, and it describes a different project. |
| G2 | `README.md` names the four views **Current / Delta / Depends on / Flows** | Shipped UI top bar reads **"API Flow"** | Low but user-facing |
| G3 | *"TypeScript end-to-end"* (fixed decision) | 1769 LOC of Python in `docs/mock` | Low — it is a mock, but it contradicts a stated fixed decision |
| G4 | *"3D as a skin, never a fork"* | `packages/skins/tiles3d` exists; `grep -rn "tiles3d" packages/ui/src packages/cli/src` → **zero hits**. Entirely unwired. README admits this. | Medium — 1217 LOC of dead weight; the intent is honored in *shape* but nothing delivers it |
| G5 | Schema defines `risk_changed`, `moved`, `renamed`; the UI has rendering paths for them | `packages/differ/src/diff.ts` emits only `removed` (36), `added` (37), `modified` (59). The other three are never produced. | Medium — schema and UI promise capability the differ does not supply |
| G6 | `CLAUDE.md`: *"Input validation via Zod / class-validator only"* | Violated at every boundary (§5) | Medium |
| G7 | `README.md` status table marks every package **"Implemented"** | True at package granularity, misleading given G4/G5 | Low |

**Credit where due:** the README's A6 section is refreshingly honest — it states 7/7 coverage, admits rank order does *not* match ground truth, admits `risk_changed` is unimplemented, admits tiles3d is unwired, and admits the light-skin vignette defect. That candor is worth preserving; G7 is the one place the documentation oversells.

---

## 8. Test failures — root cause

**13 failures, all `runAnalyze` cases in `packages/cli/test/analyze.test.ts`.** Owner has confirmed these are known and routine; documented here per request.

**Cause:** commit `bd8e074` *("make Pass B/C-groups merge-based for stability")* rewrote the Pass B and Pass C-groups **prompts** and their **response schemas**. The test's `fakeProvider()` dispatches on prompt substrings, and two of them were never updated:

```ts
if (prompt.includes("grouping the files")) {                          // STALE ── prompt now reads
  return { text: JSON.stringify({ clusters: { misc: [] } }), ... };   // STALE SHAPE ── now expects {merges}
}
if (prompt.includes("grouping a codebase's architectural layers")) {  // STALE
  return { text: JSON.stringify({ groups: {...} }), ... };            // STALE SHAPE
}
...
return { text: JSON.stringify(passAResponse), tokens: 10 };           // silent fallback
```

Current prompt text:
- `packages/interpreter/src/prompts/pass-b.ts:56` → `"You are grouping a codebase's **directories** into named modules/layers…"` (no longer *"grouping the files"*)
- `packages/interpreter/src/prompts/pass-c-groups.ts:21` → `"You are **proposing merges of** a codebase's architectural layers…"` (no longer *"grouping a codebase's architectural layers"*)

**Failure mechanism:** neither stale substring matches, so both calls fall through to the **catch-all `return passAResponse`**. Pass B then receives Pass A's `ports`/`cost` objects, which fail `MergesMapSchema` validation → 13 failures.

**Verified:** patching three things — the pass-b dispatch string, the pass-b response shape to `{merges:{}}`, and the pass-c-groups dispatch string + shape — made **all 15 tests pass**. The edit was then reverted (`git checkout packages/cli/test/analyze.test.ts`); the repo is untouched.

**Note the secondary lesson:** the catch-all fallback is what turned a *stale mock* into a *confusing schema error*. Making `fakeProvider` `throw` on an unrecognized prompt would have failed loudly at the mock, naming the exact drift, instead of failing deep in Pass B validation. Lines 177–188 also still filter on the same two stale strings, so those assertions are not measuring what they claim.

---

## 9. Product quality & usability

Exercised live via Playwright against `fixtures/orderly` (`bc3450f`), all four views plus drill-down and the light skin. **Zero console errors** in every view.

### The high point — API Flow

**This view is the product's thesis, delivered.** It traces `route → middleware → auth → handler` and attaches real semantic prose to each step alongside file path, `sloc`, and complexity. Nothing else in the tool comes close to this, and nothing in a conventional call-graph viewer does this at all. If the project needs one screenshot to explain itself, this is it.

### Defects, ranked

| # | Defect | Impact |
|---|---|---|
| U1 | **No fit-to-content / auto-zoom.** ~97% of the canvas is empty on the fixture repo; six small tiles sit in one corner. There is no pan or zoom at all — `docs/backlog/` has this as an **open** item, deferred during PR #80. | **Worst defect.** It is the first thing a new user sees and it makes the tool look empty. |
| U2 | **A tile labeled `.`** — the `.`-named group from D3 renders as a literal dot in the Layers panel *and* as a canvas tile (`. · 1`). | Reads as a rendering bug. Direct user-visible consequence of the naming gap. |
| U3 | **Truncated bubble labels** — e.g. `fastapi 0…`, with no tooltip recovery. | Information loss at the default zoom. |
| U4 | **API Flow clipped at the right edge** under the inspector panel. | The best view is the one being cut off. |
| U5 | **Clipped legend.** | Legend content is unreachable. |
| U6 | **"ENTRY POINTS" header reused in Depends-on mode**, where it is wrong. | Mislabels the panel. |
| U7 | **Delta mode renders a normal graph while displaying "No delta available."** | Contradictory state; should render an explicit empty state. |
| U8 | Light-skin vignette defect (README-acknowledged). | Cosmetic. |

U1 and U2 dominate first impression. Both are individually small fixes — a fit-to-content transform on load, and the name normalizer from D3 — and together they would lift the perceived quality of the whole product more than any other work available.

---

## 10. Recommendations, in priority order

1. **Fit-to-content on canvas load** (U1) — largest perceived-quality gain per line of code. Pan/zoom is already an open backlog item; the load-time fit is the cheap half.
2. **Deterministic group-name normalizer after Pass C-groups** (D3, U2) — strip banned suffixes, canonicalize case, reject `.`. ~20 lines. Closes the design doc's own #1 risk *and* the ugliest UI artifact.
3. **Validate the two server boundaries** (S1, S2) — a `SAFE` regex on `sha`/`skin` and `LayoutSchema.parse(req.body)`. ~4 lines total; brings the code in line with the project's own written rule.
4. **Fix `fakeProvider` and make it throw on unmatched prompts** (§8) — restores the 13 tests and prevents this exact drift from recurring silently.
5. **Correct `CLAUDE.md` / `AGENTS.md` structure line** (G1) — one line; it is the first thing every agent and contributor reads.
6. **Surface `modularity` / `directoryModularity`** (D2) — already computed in `pass-b.ts:111-112`; needs only a path to the CLI output or snapshot.
7. **Memoize `Store.readAll()`** or correct its doc comment (§4) — currently the comment is false and the cost is linear in history.
8. **Decide `tiles3d`'s fate** (G4) — wire it or archive it; 1217 LOC returning nothing is the largest single block of dead weight.
9. **`SnapshotSchema.parse` at read boundaries** (D1/S3) — turns the contract from documentation into enforcement.
10. **Reconcile README view names and the differ's unemitted delta kinds** (G2, G5).

---

## 11. What not to change

- The artifact DAG and `force` scoping in `packages/cli/src/artifacts.ts` — best-designed subsystem here; leave it alone.
- The three-hash model.
- Environment-only API key handling.
- The loopback bind in `serve.ts` — it is the control doing the most security work in the repo.
- The candor of README's A6 section.
- `docs/backlog/` and `docs/plans/` discipline.
