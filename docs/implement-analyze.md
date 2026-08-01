# implement-analyze — stack, layout, milestones

> Design intent in [`analyze.md`](analyze.md).

## Stack

**TypeScript on Node 24+, for v1.**

| Concern | Choice | Why |
|---|---|---|
| Parsing | `tree-sitter` (native Node bindings, not WASM) | Canonical grammars; native bindings parse 50k LOC in seconds |
| Grammars | `tree-sitter-{python,typescript,go,java,rust}` | One npm dep per language, loaded through a registry |
| LLM | Provider interface over `ollama` (local, default) and `@anthropic-ai/sdk` | One call-shape for both; Batch API + prompt caching on Anthropic, no batching/caching on Ollama — see below |
| Cache + index | `better-sqlite3` | Synchronous, embedded, one file, no daemon |
| Schema | `zod` → generated JSON Schema | One definition, runtime validation and published contract |
| CLI | `commander` + `ora` | Unremarkable on purpose |
| Parallelism | `node:worker_threads` over the file list | Parsing is CPU-bound and embarrassingly parallel |
| Test | `vitest` | |

### Why not Rust

Rust is the better answer for the extractor in isolation: faster, single static binary, tree-sitter's native home. It is the wrong answer for v1 of *this* project.

The dominant risk here is **semantic quality, not parse throughput**. Almost all iteration will be on prompts, clustering constraints, and risk formulas, and every one of those cycles is slower in a compiled language. Meanwhile 50k LOC parses in seconds under Node, and repos where that matters are not the v1 target.

One language across analyzer, server, and UI also means one toolchain, one test runner, one type definition of the schema shared by producer and consumer.

### LLM provider

The Interpreter calls a `Provider` interface (`interpret(prompt, context) -> {text, tokens}`), not the Anthropic SDK directly. Three implementations ship in v1:

| Provider | Use case | Notes |
|---|---|---|
| `ollama` (default) | Local, offline, no API cost | Talks to a local `ollama serve`; no Batch API, no prompt caching — Pass B/C context is resent per call, so it's slower per unit |
| `anthropic` | Cloud, best quality, Batch API for Pass A | Requires an API key; metered, not free |
| `claude-cli` | Cloud quality without metered API cost, for dev/eval | Shells out to the `claude` CLI (`claude -p "<prompt>" --output-format json`), authenticated via Pro/Max subscription OAuth rather than `ANTHROPIC_API_KEY` — usage draws down plan quota, not per-token billing. No Batch API, no prompt caching, one subprocess per call, so slower and less parallel than `anthropic`. Model and token accounting come from whatever the CLI resolves and reports at call time, not a pinned model string. Intended for interpreter development and `scv eval` runs against the fixture corpus, not for production snapshot generation |

Selected via `.scv/config.yaml` (`interpreter.provider`). Prompt templates and the `scv/1` schema are provider-agnostic; `provenance.interpreter.provider` and `.model` record which one produced a snapshot, since quality/confidence differ by model and mixing providers across a replay should be visible, not silent. Cache keys include `provider` + `model` alongside `prompt_rev` so switching providers never serves stale cross-provider results.

**Escape hatch.** The Extractor is isolated behind a process boundary and emits SymbolGraph JSON on stdout. Swapping in a Rust binary is a drop-in replacement that touches nothing else. Trigger for doing it: p95 cold extract exceeding 60s on a target repo. That is a real milestone (A7), not a someday.

### Why not Python

The visualizer is TypeScript regardless. Python would buy marginally nicer LLM ergonomics at the cost of a second toolchain, a second schema definition, and painful single-binary distribution.

---

## Package layout

```
packages/
  schema/          zod definitions, JSON Schema emit, fixtures, validator
  extractor/       tree-sitter host, grammar registry, resolver, manifests, vcs
    grammars/
      python/queries.scm
      typescript/queries.scm
      …
  interpreter/     passes A–D, prompt templates, content cache, checker
  differ/          matching, classification, blast radius, rollup, risk
  cli/             scv analyze | init | export | serve
```

`schema` depends on nothing. `extractor` depends on `schema`. Everything else depends on both. No cycles; each package ships independently.

### Adding a language

A grammar dependency plus one `queries.scm` emitting the uniform fact stream (`def`, `ref`, `import`, `inherit`, `param`, `return`, `route`, `io_call`). No core changes. **A7 exists to prove this**: if adding Go and Java requires touching `extractor/src`, the plugin boundary is wrong and must be fixed before more languages land.

---

## `scv init` — the bootstrap

Not every commit. Walking history commit-by-commit with the LLM is O(commits) spend for a cache nobody has looked at yet.

**Step 1 — HEAD, full depth.** Extract the working tree, run Interpreter A–C, write `snapshots/<head>.json`. The only expensive step, and the one that produces the "what exists now" view — the bulk of the product. Target: 50k LOC in single-digit minutes.

**Step 2 — cheap structural spine.** Walk back N revs (default: last 50 PR merges, or `--since 90d`), extracting **structurally only**, no LLM. Extraction is cached by file blob hash, so a 50-rev backfill re-parses only files that actually changed in that window — typically 5–15% of the tree. This yields the replay timeline, churn, authorship, and edge-topology deltas on day one.

**Step 3 — lazy semantic lift.** Historical semantics fill in on demand: opening a delta for rev X lifts only the units whose `text_hash` changed and lack cached semantics. Cached forever after. Most historical units are never viewed and never cost anything.

`--lift-all` does it eagerly, printing a cost estimate first.

Ongoing: a git hook or `scv analyze --pr <n>` on merge keeps HEAD current incrementally.

---

## Milestones

| M | Deliverable | Exit criterion |
|---|---|---|
| **A1** | `schema` package, JSON Schema, fixtures | Validator green on the `orderly` snapshot + delta; visualizer can build against it |
| **A2** | Extractor: tree-sitter host, Python + TypeScript grammars, resolver | SymbolGraph for a 50k-LOC repo in <30 s, ≥90% reference resolution |
| **A3** | Manifests, externals, git churn and authors | Depends-on view data complete with depth and `reached_by` |
| **A4** | Interpreter Pass A + content cache + `Provider` interface (`ollama` default, `anthropic`, `claude-cli`) | Re-run after a one-file edit costs ≤1% of a cold run; Pass A produces equivalent-shape output across providers on the `orderly` fixture |
| **A5** | Interpreter Pass B/C + deterministic checker | Modularity beats the directory baseline on 3 repos; `orderly` reproduces the ops cluster (`admin_tasks` grouped with `scripts`) from source alone |
| **A6** | Differ, rollup, Pass D risk | **`orderly` inspect queue returns 7/7 against `task/RL-114.deltas.json` with an LLM in the loop**; spot-check 20 real PRs against human ranking |
| **A7** | Go + Java grammars via the plugin path only | Zero changes under `extractor/src`. If throughput now fails A2's bar, extract the Rust binary here |
| **A8** | `scv export --structural` | Round-trip: commit, wipe cache, regenerate, diff clean |

A1 freezes the contract. Everything after it overlaps with Phase 2.

### On A6

A5 and A6 are the real project. A2–A4 are known engineering; A5–A6 are where it either works or does not.

The `orderly` fixture currently passes 7/7 with hand-authored interpretation ([`analyze.md`](analyze.md#validation)) — that validates the *schema*, not the *analyzer*. A6 is the same test with the hand-authored file removed. Treat a 5/7 as informative, not as failure: read which two it missed before touching the prompt.

---

## Prompt engineering as a first-class artifact

Prompts live in `interpreter/prompts/*.md`, versioned by `prompt_rev`, which is stamped into every cache key and every snapshot's provenance. Changing a prompt invalidates exactly the cached results that depended on it, and any snapshot in the wild can be traced to the prompt that produced it.

`packages/interpreter/eval/` holds the fixture corpus. `scv eval` reruns the corpus and diffs against recorded expectations. A prompt change that regresses `orderly` below 7/7 does not merge.
