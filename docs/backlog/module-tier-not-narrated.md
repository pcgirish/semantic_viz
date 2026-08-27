# Modules are the one tier with no narration and no name of their own

**Status:** open
**Found:** 2026-08-27 (drilling group → layer → module → function on the `c5ee733` snapshot)
**Filed here:** 2026-08-27

## Problem
Narration has a hole in the middle of the hierarchy. Drilling one path through a
fully-interpreted snapshot:

| Level | Unit kind | What/how/when/where/why |
|---|---|---|
| Backend Packaging | `group` (`u:group:2c877ccec255`) | full, conf 0.70 |
| Word Problem Core | `layer` (`u:layer:ef23834e7c4b`) | full, conf 0.85 |
| `word_problem.py` | **`module`** | **absent** |
| `generate_word_problem` | `function` | full, conf 0.95, tags, signature |

Every tier above and below the module carries semantics. Only the module is blank
— and it is the tier a developer is most likely to be looking at, since the
canvas at that depth is file-shaped and the tiles are filenames.

## Cause
`orchestrate.ts:119` defines the set the narration passes run over:

```ts
const LEAF_KINDS = new Set(["function", "class"]);
```

Layers and groups are not in that set but get semantics anyway — they are
*synthesized* by `runNarrationPass` from Pass C output (`orchestrate.ts:582`).
So there are two ways a unit ends up narrated, and `kind: "module"` is in
neither.

Modules are only ever *read*:
- as clustering input — `runClustersPass` maps file → module unit, then throws
  the unit away and clusters the files (`orchestrate.ts:452-464`)
- as a one-liner source for Pass C, which reaches *past* the module into a member
  function's `semantics.what` (`orchestrate.ts:541-542`):
  ```ts
  const withSemantics = leafUnitsByFile.get(file)?.find((u) => u.semantics);
  oneLiners[file] = withSemantics?.semantics?.what ?? "(no summary)";
  ```

That second one is the sharp detail: the pipeline already computes a
module-level summary and discards it. Nothing ever writes back to the module unit.

## The same hole shows twice: names
A module's `name` is the file path, set verbatim at extraction
(`walk-python.ts:565`, `name: file`; `walk-typescript.ts:435` does the same).

This is not an oversight — **a module has no name of its own in either
language.** A class has `class Foo`, a function has `def foo`, and the extractor
reads those identifiers directly. A Python module *is* its file: it acquires the
name `word_problem` by existing at that path, with no in-file token to read. The
path is the only name available at extraction time.

But every other tier gets a *chosen* name from narration — "Word Problem Core",
"Backend Packaging" are Pass C output resolved by `resolveLayerNames`
(`orchestrate.ts:558`), not path-derived. Modules skip narration, so they never
get a meaningful name either. One cause, two symptoms.

If module narration is built, it should emit a name alongside the prose, and the
two should land together rather than as separate work.

## Fix options
Cheapest, no LLM call: compose a module's `what` from its children's
`semantics.what` — the reach-through Pass C already does at line 542, persisted
onto the module instead of discarded. Gets a `what` and little else; `how`/`when`/
`why` do not compose as cleanly from a list of function summaries.

A real pass reads better and can produce all five fields plus a name, at one call
per module. Worth pricing against module count before choosing — this is the
most numerous narratable tier by a wide margin.

## Blocked on a schema decision
`Unit` has `name` and `qualname` and no display-name field
(`packages/schema/src/index.ts:121-122`). `Inspector.tsx:131` renders
`<Tray title={unit.name}>` for every kind, so a narrated module name has nowhere
to live without either overwriting `name` (losing the path, which is what a
developer greps for) or adding a field.

Recommendation: add a field rather than overwrite. The filename is the correct
*fallback* — unambiguous, matches what is on disk. The goal is a narrated name
displayed over it, not instead of it.

## Also: the empty-state copy is wrong here
`Inspector.tsx:190` renders, for any unit without semantics:

> Not yet available — no Interpreter pass has run on this snapshot.

For a module that statement is false. Passes ran; they produced the layer, group
and function panels visible in the same session. The message blames a missing run
for what is actually "this kind is never narrated", so a user with a complete
snapshot reads it as an incomplete one.

Fix alongside whichever narration decision lands: either the message becomes
kind-aware, or the card is omitted for kinds that never carry semantics. Doing it
before then is still an improvement over a message that is simply untrue.

## Adjacent, not part of this
`Unclustered` carries **212 links** in the connected-siblings tray — the largest
coupling of any sibling by a wide margin, well beyond `Backend Packaging` (10) or
`Database Migrations` (9). A catch-all outweighing every real cluster suggests
the clustering thresholds leave too much unassigned. Separate investigation;
noted here only because it surfaced in the same drill-down.
