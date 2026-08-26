---
name: agent-analyze-docs
description: Author doc extracts (purpose, modules, architecture notes) for a repo's README and docs/ files and inject them into scv's artifact cache with zero LLM/provider calls. Use when asked to summarize a repo's documentation for scv without running scv's real Pass Docs.
---

# Agent-authored doc extracts

Pass Docs reads each README/`docs/` file and extracts the parts that inform
clustering: what the doc is for, which modules it names, and any architecture
notes. It costs one provider call per doc. An agent that has already read those
files can write the same extracts directly.

`scv merge-semantics --with-docs` writes them to the `docs` artifact with an
`inputHash` a later `scv analyze` matches, so Pass Docs never runs.

## Why this matters beyond the docs artifact

Clustering (Pass B) is deterministic but **consumes `docs`**. Merging docs
before clustering is what makes the resulting layers reflect the repo's own
vocabulary rather than directory names alone. Author docs before running
`scv analyze <root> clusters`.

## Discover the real doc paths

```sh
scv analyze <root> --no-llm
```

Paths come from the CLI's own discovery: root-level `.md`/`.rst` files, plus
everything under a top-level `docs/`/`documentation/` directory, recursively.
**A `path` that discovery did not find is skipped with a warning** — the `docs`
input hash is computed over the discovered set, so an undiscovered path could
not survive the next analyze anyway.

## Author the pending file

Read each doc, then write `.scv/pending/<sha>/semantics-docs.json`. The
filename is a convention for your own bookkeeping; the CLI accepts any path.

```json
{
  "meta": { "agent": "agent-analyze-docs" },
  "docs": {
    "readme": {
      "path": "README.md",
      "purpose": "Explains what the service does and how to run it",
      "modules": [
        { "name": "orders", "description": "Order lifecycle and state machine", "paths": ["src/orders.py"] }
      ],
      "architecture_notes": ["Handlers call services; services own all database access"]
    }
  }
}
```

- The key (`"readme"`) is an arbitrary label of your choosing — `path` is what
  identifies the doc.
- `modules` names the components the doc actually discusses; `paths` are
  best-effort and may be empty.
- `architecture_notes` are constraints or structural claims stated in the doc,
  one per entry. Do not invent notes the doc does not make.

## Merge

```sh
scv merge-semantics .scv/pending/<sha>/semantics-docs.json <root> --with-docs
```

Failure modes are per-entry, so one bad entry never discards the rest:

- `path` not among the discovered docs → warned and skipped.
- Two entries claiming the same `path` → the first wins, the second is warned
  and skipped.

Output is written in discovery order, not pending-file key order, so re-merging
the same content produces a byte-identical artifact.

## Verify

```sh
scv analyze <root>
```

Confirm the progress log reports no Pass Docs calls. Then continue with
`agent-analyze-clusters`, which depends on this artifact.
