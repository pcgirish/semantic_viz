# analyze — what the analyzer produces, and why

> Contract and formulas live in [`design.md`](design.md#schema-contract--scv1). This document covers intent and behaviour.

The analyzer's job is to produce a document that someone could read *instead of* reading the codebase, and still be right. That sets a high bar on two things it must never confuse: what is **true** and what is **judged**.

Every field carries `source`. Static fields are facts, reproducible from the tree. Interpreter fields are opinions, cached and versioned by prompt. The visualizer renders them differently. A reviewer must always be able to ask "who says?" and get an answer.

---

## 1. Extractor — deterministic

No LLM. Cacheable, keyed by file blob hash, so a one-file edit costs a one-file re-parse.

- **Parse.** tree-sitter per language → per-file AST. The grammar set is a plugin registry: adding a language is a grammar plus a ~200-line query file, no core changes.
- **Query.** Each language ships `.scm` queries emitting one uniform fact stream: `def`, `ref`, `import`, `inherit`, `param`, `return`, `route`, `io_call`. The uniformity is the point — everything downstream is language-blind.
- **Resolve.** Two passes. Pass 1 builds a per-file symbol table. Pass 2 resolves references within a language, then across via import maps. **Unresolved references are kept as `confidence<1` candidates, never dropped** — a missing edge is invisible, a low-confidence edge is reviewable.
- **Manifests.** `package.json`, `pyproject`/`requirements`, `go.mod`, `pom.xml`, `Cargo.toml` → externals, plus lockfile depth.
- **VCS.** `git log --numstat` per file → churn, commit count, per-author line counts. `git log -L` only on demand; it is slow.
- **Optional LSP boost.** Where a language server is available, use it for cross-file resolution and degrade gracefully when it is not.

Output: **SymbolGraph**.

### What "sloc" means here

Non-blank, non-comment lines. And `hash.text` is computed over *normalized* source — comments stripped, whitespace collapsed. A reformat therefore produces no text delta, which is what makes the `42406d1` "adjust log line format" commit interesting rather than noisy: the analyzer sees the field rename, not the reflow.

---

## 2. Interpreter — LLM

Five passes, bottom-up, so context stays bounded. Every pass is cached by `input_hash + prompt_rev`.

**Pass A — leaf semantics.** Per function and class: source plus resolved neighbours → `what / how / when / where / why`, port descriptions, a cost estimate, tags. One unit per call, batched.

The five questions are not decoration. `what` and `how` are recoverable from the code. **`why` is the one an LLM can supply and a parser cannot**, and it is the field most likely to be wrong, which is why it carries confidence.

**Pass Docs — repo doc extraction.** Runs once per analyze, one call per discovered doc (root-level and `docs/`-level `.md`/`.rst` files). Extracts `purpose`, named `modules` (with optional paths), and `architecture_notes` from each doc — structural signal, not a raw summary, and not truncated regardless of doc length. A doc with no extractable structure (e.g. CONTRIBUTING.md) validly returns empty `modules`/`architecture_notes`. Combined with a directory tree built from the same file list Pass B sees, this forms the "Repo context" section folded into Pass B and Pass C prompts.

**Pass B — clustering.** The load-bearing pass: form modules and layers that are *not* directory-shaped. **No LLM is involved.** Input is the file list and the import graph; output is a partition, keyed by structural id, produced by weighted agglomerative single-linkage clustering (`interpreter/src/cluster.ts`):

- **Affinity.** Undirected weight per file pair is `max(w(a→b), w(b→a))`, duplicate same-direction edges summed first. Sum within a direction is right — two imports of one module from one file are two facts about one relationship — while `max` across directions keeps a high-fan-in utility from being dragged into a cluster by many weak inbound edges.
- **Retention.** An edge survives only if it is significant at *both* endpoints: `w(a,b) >= max(MIN_EDGE_WEIGHT, RELATIVE_EDGE_RATIO * maxIncident(a), RELATIVE_EDGE_RATIO * maxIncident(b))`, with `maxIncident` computed before any retention so the rule is order-independent. Requiring both ends is the primary defence against single linkage's chaining.
- **Merging.** Single linkage — the maximum retained affinity across member pairs — above `MERGE_THRESHOLD`. Average linkage was tried and rejected: it penalizes a cluster for growing, diluting a real relationship with a cluster's unrelated members.
- **Ties** break by score desc, total retained weight desc, member count asc, then sorted member list asc. That last key is a total order over distinct member sets, so no seed, insertion order, or filesystem order can reach the result.
- **Fallback.** With no retained edge at all, the directory baseline stands in — never chosen by a modularity comparison, since modularity cannot rank partitions of differing granularity.
- It partitions every file — no orphans — and `assertStrictPartition` throws rather than repairs, because any violation is an algorithm bug rather than an untrusted response.

Determinism is what makes this shippable. Previously the LLM proposed and a checker repaired; the contract asked which whole *directories* to union, so no response could ever split one, and names and membership still drifted between runs on unchanged source.

*Worked example.* In `orderly`, `src/admin_tasks.py` sits inside the application package but imports `scripts.backfill` and has no importers of its own. Directory-shaped grouping files it under the domain. Import-cohesion grouping files it with `scripts/`. The second answer is the true one, and the clustering above reaches it from the import graph alone.

**Pass C — architecture narration.** Names and narrates each cluster — one call per cluster, in ascending structural-id order. It cannot influence membership. A cluster whose structural id matches the nearest analyzed first-parent ancestor's has identical membership by construction, so its whole record is carried over verbatim and no call is made. Also: layers, `api_flow` units (route handler → service → store, traced along real edges), system-level `why`, and the external-dependency story.

`api_flow` units are how cross-language edges get expressed: a TypeScript client and a Python handler are matched by route string, marked `source:"llm"`, `confidence<1`.

**Pass D — risk narration.** Runs only for units whose `semantic_hash` changed. Writes the five axes and the `why`. See §4.

**Cost control.** Content-addressed cache; only units whose `text_hash` changed are re-lifted. Pass B costs nothing — it makes no LLM calls — and Pass C is skipped per cluster whose membership is unchanged since the last analyzed ancestor.

---

## 3. Differ

1. **Match** units across snapshots by `id`, then by rename detection — `struct_hash` plus path similarity plus git rename info.
2. **Classify** from the three hashes. Only units whose `semantic_hash` differs get an LLM risk call.
3. **Blast radius** computed from the *new* edge index, transitively, capped at depth 4.
4. **Roll up** to every ancestor.

### Granularity

`scv analyze --rev <sha>` per commit; `scv analyze --pr <n>` collapses a PR to a single base…head delta.

Commit-level snapshots are **structural only** and lifted lazily. PR-level snapshots are always fully lifted. This is the whole reason replay is affordable: a 50-commit history costs 50 cheap parses and zero LLM calls until someone actually opens one.

---

## 4. Risk

Five axes, scored independently: **functionality, availability, scalability, performance, security**.

Independent axes because they genuinely dissociate. The `orderly` rate limiter scores 0.4 on functionality and 0.95 on availability — it does exactly what was asked, and it is the single most likely cause of a total outage in the tree. A scalar would average that into something useless.

`score` = max of axes. The formula floor is retained alongside it.

### Rank is not score

The **inspect queue** is ordered by the Interpreter's judgment of what a human should look at first, which is deliberately not the same as sorting by `risk.score`. Running the `orderly` fixture:

| rank | unit | risk | conf | why it sits there |
|---|---|---|---|---|
| 1 | `rate_limiter` | 0.95 | 0.78 | Unguarded Redis in the request path |
| 2 | `utils.logging` | **0.25** | **0.55** | Low score, low confidence, unobservable blast radius |
| 3 | `api.routes` | 0.60 | 0.82 | Public contract changed, spec not updated |

Rank 2 outscores rank 3 on *nothing*. It ranks above it because the analyzer **cannot see** the downstream log parsers, and an unknown is worth a human's attention more than a known-medium. Encoding that requires rank to be its own field with its own rationale.

If you disagree with this — if you want the queue to be `sort by score desc` — that is a one-line change and a defensible product decision. It should be a decision, not an accident.

### Risk without change

`tests/integration/test_orders.py` has status `risk_changed`: not one line differs, but the thing it tests gained a dependency, and the tests were never re-run. Its risk moved because its *situation* moved.

This requires risk to be a property of a unit's position in the graph, not a function of its diff. Any design that computes risk from the patch alone cannot express it — and it is exactly the failure mode that hurts, because nothing in a diff view will ever show you a file that didn't change.

---

## 5. Validation

Run against the `orderly` fixture, whose seven ground-truth deltas were hand-built by a human before this analyzer existed:

```
delta 6ab4e5e..bc3450f   38 unit deltas, 12 edge deltas, queue of 7
  1. src.api.middleware.rate_limiter   added         risk 0.95  conf 0.78  gt=d1,d2
  2. src.utils.logging                 modified      risk 0.25  conf 0.55  gt=d6
  3. src.api.routes                    modified      risk 0.60  conf 0.82  gt=d3
  4. tests.test_rate_limiter           added         risk 0.10  conf 0.93  gt=d1
  5. tests.integration.test_orders     risk_changed  risk 0.65  conf 0.85  gt=d7
  6. src.config                        modified      risk 0.35  conf 0.90  gt=d4
  7. src.utils.throttle                removed       risk 0.20  conf 0.88  gt=d5
```

7/7, in order.

**What this proves:** the schema can carry every distinction the ground truth makes — including `risk_changed`, mixed authorship, and low-confidence-high-rank. The structural half (units, edges, hashes, churn, authors, externals, blast radius, rollup) is genuinely computed from the repository. The edge deltas correctly detect the `throttle` removal and the new `routes → rate_limiter` import.

**What this does not prove:** ranking quality. The rank order came from `tools/interpret.json`, which is hand-authored. The real test — A5 and A6 in [`implement-analyze.md`](implement-analyze.md) — is an LLM producing that queue from source alone and being scored against the same file.

`orderly` is now a regression fixture: any change to the formulas or prompts reruns against it and must still return 7/7.
