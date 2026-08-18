# Feed repo docs + directory structure into Pass B/C prompts

## Context
Pass B (file clustering) and Pass C (layer narration + grouping) currently see only
per-file one-liners and the import-edge graph (`packages/interpreter/src/prompts/pass-b.ts`,
`pass-c.ts`, `pass-c-groups.ts`). They have no access to the repo's own design
documentation (README, `docs/design.md`, ADRs, etc.) or its directory layout, so
clustering/narration can only infer intent from imports — it can't use intent the repo
authors already wrote down. This must work generically across arbitrary target repos
(scv analyzes other people's codebases), so discovery can't hardcode filenames like
`docs/design.md` — that's specific to this repo, not a general convention.

Goal: gather a bounded set of markdown docs (root + `docs/`) and a directory-structure
summary once per analyze run, and thread them into the Pass B/C prompts as optional
extra context.

## Discovery rule (generic, no hardcoded filenames)
In `packages/cli/src/analyze.ts`:
- Glob `*.md` / `*.rst` directly at `options.root` (case-insensitive extension match).
- Glob `*.md` / `*.rst` anywhere under a top-level `docs/` or `documentation/` directory
  (case-insensitive dir name), recursive.
- Skip anything under `node_modules`, `.git`, `.scv`, or other extractor-ignored paths
  (reuse whatever ignore logic `extractRepo` already applies, if exposed; otherwise a
  minimal denylist).
- No arbitrary truncation. Instead, each discovered doc is run through a new
  Interpreter pass call (below) that extracts structural signal — purpose, named
  modules, architecture notes — before being folded into the Pass B/C prompt. This
  bounds prompt size regardless of source doc size and turns prose into the kind of
  signal Pass B can actually act on (module hints), not just more text to read.
- Skip empty/near-empty files (e.g. < 20 chars) — not worth an LLM call.

## New pass: doc structural extraction
Add a small Interpreter pass (`packages/interpreter/src/pass-docs.ts`, e.g. `runPassDocs`)
analogous in shape to Pass A: one LLM call per discovered doc file. Rather than a generic
summary, the prompt asks the LLM to extract only what's useful for clustering/narration:

```json
{
  "purpose": "one sentence, what the system/doc is about",
  "modules": [
    { "name": "...", "description": "...", "paths": ["dir/or/file, if the doc names one"] }
  ],
  "architecture_notes": ["short bullet points on layering, boundaries, data flow, etc."]
}
```

`modules[].paths` lets Pass B treat a doc-named grouping as a strong hint even when the
doc doesn't literally list files — it can name a directory or a component by role
("the ingestion layer") without a path, in which case `paths` is empty and only
`name`/`description` carry signal. Schema is Zod-validated the same way other pass
responses are (`interpretJsonWithRetry`); a doc with no extractable structure returns
empty `modules`/`architecture_notes`, which is a valid, non-error result — not every
doc (e.g. a CONTRIBUTING.md) has module/architecture content.

Content-cached the same way other passes are (keyed on file content hash, via the
existing `CachedProvider`/`ContentCache` — no new caching mechanism). Runs once per
analyze, in parallel (small N, no concurrency cap needed like Pass A's
`PASS_A_CONCURRENCY`).

Output: `{ path: string; purpose: string; modules: {...}[]; architecture_notes: string[] }[]`,
formatted into the "Repo context" section instead of raw doc content — structured enough
that Pass B can be told explicitly "if a file's path matches a module hint below, prefer
grouping it accordingly unless imports strongly disagree."

## Directory structure
Derive from the file list already available in `orchestrate.ts` (`files`, the same list
Pass B receives) — no extra disk I/O, no LLM call. Build an indented directory tree (or
simple sorted path listing) capped at a reasonable depth/line count for large repos.

## Plumbing
- `RunInterpreterOptions` (`orchestrate.ts`) gains an optional field, e.g.
  `repoContext?: { docs: { path: string; content: string }[] }` — raw content in, summarized
  inside `orchestrate.ts` via the new pass. Directory tree is computed inside
  `orchestrate.ts` from `files`, not passed in.
- `analyze.ts` reads matching doc files under `options.root` (full content, no truncation),
  passes as `repoContext.docs` into `runInterpreter`.
- `orchestrate.ts` runs `runPassDocs` over `repoContext.docs` to get structured extracts,
  builds the directory tree from `files`, combines both into a single formatted
  "Repo context" string, passes to `runPassB`, `runPassC`, `runPassCGroups`.
- `prompts/pass-b.ts` explicitly instructs: doc-derived module hints are a signal to
  weigh alongside import edges, not an override — the existing "prefer cuts that minimize
  import edges crossing between clusters" rule stays primary; docs can tip ambiguous cases
  and suggest names, but a hint whose files/paths don't match reality is still subject to
  the same `checkAndRepairClusters` enforcement as everything else in the LLM's proposal.

## Target cluster count
Today's Pass B prompt gives the LLM no sense of how many clusters is reasonable, which
is a likely cause of the too-fine / arbitrarily-merged results observed in practice —
nothing stops 3 clusters for 60 files or 20 clusters for 15 files. Add a computed
guidance line to `passBPrompt`, e.g.:

```
target = clamp(round(sqrt(files.length)), 2, 12)
```

Rendered into the prompt as a rule: "Aim for roughly `${target}` clusters (not a hard
requirement — deviate if the import graph clearly calls for more or fewer), given
${files.length} files." Keep it advisory, not enforced by `checkAndRepairClusters`
(which only guarantees partition validity, not cluster count) — over-constraining count
risks forcing bad merges/splits when the real structure doesn't fit the formula.
- Prompt builders (`prompts/pass-b.ts`, `prompts/pass-c.ts`, `prompts/pass-c-groups.ts`)
  each gain an optional `repoContext?: string` parameter, rendered as a new section
  ("## Repo context (docs + directory structure)") inserted before "Rules", so it's
  available but doesn't override the file-list/edge-based instructions already there.
- All new params optional / additive — no signature break for existing callers other
  than the ones we update; tests default to omitting repoContext.

## Files touched
- `packages/cli/src/analyze.ts` — doc discovery + read (full content)
- `packages/interpreter/src/pass-docs.ts` — new pass, one summarization call per doc
- `packages/interpreter/src/prompts/pass-docs.ts` — new prompt builder
- `packages/interpreter/src/orchestrate.ts` — directory tree build, invoke `runPassDocs`, repoContext plumbing into Pass B/C calls
- `packages/interpreter/src/pass-b.ts`, `pass-c.ts` — accept/forward `repoContext`
- `packages/interpreter/src/prompts/pass-b.ts`, `pass-c.ts`, `pass-c-groups.ts` — render repo-context section; `pass-b.ts` also gets target-cluster-count guidance
- `packages/interpreter/src/index.ts` — export `runPassDocs` alongside other passes
- `packages/interpreter/src/orchestrate.ts` `RunInterpreterOptions` — new optional field

## TDD order (per CLAUDE.md: RED before implementation)
1. `prompts/pass-docs.ts`: failing test for the extraction prompt shape (purpose/modules/architecture_notes).
2. `pass-docs.ts`: failing test asserting one provider call per doc, schema-validated structured response, empty-modules doc handled as valid.
3. Prompt builders (pass-b/pass-c/pass-c-groups): failing test asserting repo-context section appears/omitted correctly; `pass-b.ts` also tested for target-cluster-count line at a few file-count sizes (clamped min/max).
4. `analyze.ts` doc discovery: failing test with a fixture repo tree (root README + docs/ subfolder + noise files to exclude) asserting correct file set, no truncation.
5. `orchestrate.ts`: failing test asserting Pass Docs runs and its summaries + directory tree reach Pass B/C.
6. Implement each to green.

## Verification
- `npm test` (interpreter + cli packages) green.
- `npm run lint` clean.
- Manual: run `scv analyze` against `fixtures/orderly` (has `README.md`) and confirm
  via `--logLevel debug` or a temporary log that Pass Docs ran, produced a summary,
  and the repo-context section reaching Pass B/C is non-empty and reasonably bounded.

## Docs to update
Per `CLAUDE.md`'s per-milestone README rule and `docs/plans/README.md`'s plan-archival
convention:
- `docs/design.md` — add Pass Docs to the pipeline description (new pass between
  Pass A and Pass B in the Interpreter section); note repo-context (docs + directory
  structure) as an input to Pass B/C clustering/narration.
- `docs/analyze.md` — describe the new pass and how doc-derived module hints factor
  into Pass B's clustering, alongside the target-cluster-count heuristic.
- `README.md` — update the `packages/interpreter` row in the package-status table to
  mention Pass Docs; update the "Configuring the LLM provider" / pass-cost section if
  it enumerates passes (Pass A/B/C/D) to include the new call.
- This plan file itself: once approved and implementation starts, copy it into
  `docs/plans/` (per that folder's own README convention) and add a row to
  `docs/plans/README.md`'s table, committed alongside the implementation — not deferred
  to the end.
