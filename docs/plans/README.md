# Plans

Implementation plans produced during Claude Code plan-mode sessions, migrated here from
`~/.claude/plans/` (a local, non-version-controlled directory where filenames are random
slugs and reused slugs silently overwrite prior content). Kept here so plan history is
diffable and durable.

| File | Plan |
|---|---|
| `iterative-bubbling-horizon.md` | Codebase Visualizer (project_viz) — original architecture pipeline |
| `zesty-wishing-meteor.md` | Clean up tracked build artifacts before implementation |
| `draft-it-as-a-abstract-penguin.md` | Batch entity summarization in `summarizeEntities` |
| `can-we-fix-both-gleaming-karp.md` | Fix grammar-key legend fidelity + plate side-count encoding |
| `do-we-have-the-cuddly-meerkat.md` | Visualization fixes & compact hop-column redesign |
| `look-into-what-shows-abstract-valley.md` | Variable sides in Architecture view, fan-based sizing |
| `flows-pass-c.md` | Pass C: generate `api_flow` units (Flows view) |
| `soft-bubbling-valley.md` | Group layers into architectural groups, render region boxes |
| `function-flowchart-extraction.md` | Function-internal flowchart extraction (TypeScript + Python) |
| `pass-a-graph-context-and-cheaper-passes.md` | Pass A graph context (callers/callees, bottom-up ordering, cache-key fix), LLM call logging, drop fewer/cheaper-pass gaps |
| `review-reconciliation-security-and-correctness.md` | Reconciles `docs/review/` findings: server path traversal, extractor symlink exfiltration, risk-floor bypass, missing runtime validation, dependency CVEs, docs/impl drift |
| `flowchart-block-labels-readability.md` | Semantic block labels (batched per-function LLM step), yes/no edge labels, sequential-block collapsing, flowchart header framing |
| `test-folder-flat-module-no-analysis.md` | Flatten test-folder hierarchy to one module level, skip flowchart/block extraction and all LLM passes for test units |
| `llm-call-timing-and-progress.md` | Per-call LLM timing, sub-phase in-flight progress logging, duration on INFO lines, end-of-run timing summary |
| `repo-docs-and-directory-context-for-pass-b-c.md` | Feed repo docs (README/`docs/`) + directory structure into Pass B/C prompts via new Pass Docs extraction pass, plus Pass B target-cluster-count heuristic |

New plans: write to `~/.claude/plans/` as usual during plan mode, then copy the approved
file here (and commit) once implementation starts, so its history is preserved.
