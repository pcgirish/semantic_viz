# Overall project review — 2026-08-21

## Verdict

**NEEDS CHANGES.** The project has a credible static-analysis spine, a useful schema, and a
reasonable 2D interaction shell. It is not yet reliable as a codebase-understanding tool because
its most important product contract—the hierarchy used for zoom and navigation—is neither
deterministic nor structurally represented.

The urgent work is not more skin polish. Establish one stable, evidence-backed hierarchy first.
Treat LLM output as labels and explanations of that hierarchy, not as the authority that creates
it. Until then, every visual skin inherits an unstable mental model.

## Scope and verification

Reviewed the extractor, interpreter passes, schema, layout engine, UI composition, 2D skin,
`tiles3d`, and `cityscape`, plus tests, plans, and design documentation.

Checks completed:

- `npm test` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; Vite reports a 593 kB minified 3D chunk.

The passing suite is mostly unit and component coverage. It does not establish that a real
repository receives a useful hierarchy, that two analyses converge, or that the rendered 2D/3D
experience is usable.

## Product assessment

The intended product has two linked jobs:

1. Build a trustworthy map of a codebase at several useful levels.
2. Explain and compare changes between revisions without making the reviewer reconstruct the
   architecture manually.

The current implementation is stronger at extracting symbols and drawing a graph than at
choosing the right abstractions. It currently exposes:

`system → layer → module → class/function → block`

but only `layer` is synthesized as an architectural abstraction, and it is synthesized by an
LLM from directory groups. `group` is not a level in the tree. Consequently the product cannot
guarantee that “zoom in” means the same kind of refinement across repositories or analysis runs.

## Blocking findings

### P0 — The hierarchy is LLM-authored, unstable, and not evidence-constrained

`runPassB` starts from parent-directory buckets and lets the model merge those directories into
named clusters (`packages/interpreter/src/pass-b.ts:37-105`). This means it cannot split a
directory containing multiple concepts, cannot form a precise module from files across a
directory boundary except by merging whole directories, and lets the model choose the partition.
Static imports and calls provide context and a score, not authority.

The repair code guarantees coverage, not correctness. `modularity()` measures the percentage of
edge weight kept inside clusters (`packages/interpreter/src/checker.ts:113-134`). A single giant
cluster scores perfectly, so the metric does not distinguish a useful partition from a useless
one. It does not penalize cluster count, imbalance, directory leakage, or cross-cluster coupling.

This directly explains different modules on different runs. Normalizing names and hashing file
membership stabilizes labels and IDs, but does not stabilize the partition.

Required direction:

- Make the structural hierarchy deterministic and primary: repository/package, directory,
  source module/file, symbol, and control-flow block. Include language-aware package boundaries
  and test/generated/vendor classification.
- Derive candidate architectural communities from the resolved graph with a deterministic,
  seeded algorithm and explicit constraints. Preserve directory boundaries as evidence, not as
  the algorithm itself.
- Use the LLM to name, summarize, explain, and optionally suggest alternatives. Never let it
  silently replace the canonical partition.
- Store membership evidence and confidence: imports/calls, directory cohesion, shared external
  dependencies, public API overlap, and why a boundary exists.
- Add quality gates: size limits, singleton policy, edge-cut ratio, directory-baseline comparison,
  stability across seeded runs, and fallback to the structural hierarchy when a candidate fails.
- Version grouping inputs/results so a re-analysis can explain why a boundary changed.

### P0 — `group` is presentation metadata, not a usable hierarchy level

Pass C groups layers and writes only a string field onto each layer
(`packages/interpreter/src/orchestrate.ts:601-615`). The schema explicitly describes `group` as
“one level above layer” while also saying it is not a parent/child edge
(`packages/schema/src/index.ts:129-139`). No group units are created, no group IDs are persisted,
and no group-level edges or semantics exist.

The system unit’s children are layer/flow units (`orchestrate.ts:812-836`), not group units. The
layout reconstructs regions from the string and only draws a region when two layers share a group
(`packages/layout/src/layout.ts:78-111`). A user cannot drill into a group, inspect its meaning,
or rely on group membership as a stable level. This is visual decoration masquerading as
hierarchy.

Required direction:

- Decide whether group is a real level. For the stated product, it should be.
- Add stable group units with IDs, parent/children, semantics, metrics, hashes, and rollup edges;
  make the system point to groups, groups to layers, and layers to modules.
- If group is not a level, remove it from the schema and UI language.

### P0 — Parent/children relationships are inconsistent

When a cluster is built, `memberUnits` contains every unit in the files, not only modules
(`packages/interpreter/src/orchestrate.ts:499-504`). The generated layer stores all of those IDs
as children (`orchestrate.ts:513-527`). Finalization changes only module parents
(`orchestrate.ts:838-843`). A function can therefore remain parented by its module while also
appearing directly in its layer’s `children` list.

The schema validates field shapes, not tree invariants (`packages/schema/src/index.ts:112-139`).
The layout walks `parent`, while other UI code can use `children`; consumers can disagree about
the visible level and drill target.

Required direction:

- Define one tree invariant: every non-root unit has exactly one parent and each parent’s
  `children` contains exactly its direct children.
- Build hierarchy bottom-up from module membership. A layer’s children must be modules only;
  module children remain classes/functions; class/function children remain blocks.
- Add validation for reciprocal links, unique parents, acyclicity, and exactly one system root.
- Add fixture tests asserting the complete tree, not only that a layer exists.

### P1 — “Module” is used for incompatible concepts

The schema supports `package`, `module`, and `layer`, but the current clustering pipeline operates
on files and creates only `layer` architectural units. A file/module is a static source boundary;
a layer is an architectural concept; a group is a higher-order concept. The prompts and UI blur
these terms, so a user cannot tell whether a tile represents a file, directory, community, or LLM
interpretation.

Define and display explicit vocabulary:

- package: manifest/import boundary;
- directory: filesystem context;
- module: source file or language-specific module boundary;
- layer/community: evidence-backed architectural grouping;
- group/system: optional higher-level product view;
- symbol/function/block: progressively finer static units.

Each level needs an explicit purpose, expected cardinality, stable identity, and drill behavior.

### P1 — Edge rollups are not aligned with the hierarchy

The finalizer rolls edges up to layers by mapping source units to their first file and then to a
layer (`orchestrate.ts:846-881`). It creates useful aggregate edges, but no group rollups, and
leaves leaf edges alongside rollups. The UI must infer visible endpoints and may draw multiple
representations of the same relationship.

The grouping pass also selects the first module for a file when deriving layer edges
(`orchestrate.ts:579-590`), a fragile shortcut for multi-unit or multi-file boundaries.

Define edge visibility and rollup rules per level. Compute rollups from the canonical tree, not
`loc.files[0]` or an arbitrary first module. Give rollups provenance: contributing edge IDs,
count, weight, confidence, and evidence. Emit one visible edge per relationship policy at each
level, with explicit rules for internal, cross-level, and unresolved edges.

## Analysis pipeline findings

The extractor is the strongest part of the system: deterministic facts, symbol resolution,
retained low-confidence unresolved references, and explicit graph edges. Pass A’s bottom-up
processing and graph context are also the correct direction. Static analysis should own
existence/connectivity; the LLM should own prose and interpretation.

Zod validates response shape, but not architectural quality. A technically valid but poor cluster
passes. Surface repairs, confidence, rejected proposals, and fallback decisions in the snapshot
and UI.

Add a fixture containing: a directory with two unrelated modules; one conceptual module spanning
directories; a package boundary; generated/test code; a cycle; a high-fan-in utility; and a
rename/move between commits. Run repeated analyses with different provider responses and assert
that the canonical tree is unchanged while names/prose may vary within bounds.

Stable identity is also essential for PR review. Hashing exact layer membership is a reasonable
local mitigation, but reclustering still appears as remove/add and obscures source changes. The
differ needs hierarchy-aware matching: structural identity first; architectural matching by
member overlap and parent context; explicit split/merge classifications; and separate
“interpretation changed” from “membership changed.”

## Visualization assessment

### 2D: serviceable shell, but connector density is a data-policy problem

The 2D view has the best interaction model: pan/zoom, selection, drill/ascend, search, inspector,
legend, and flow views. Connector problems are not only routing defects. The view receives many
relationships and relies on routing/spreading plus focus to make them readable. There is no clear
per-level edge budget, bundling policy, or “changed/important edges first” policy.

Prioritize edge budgets by level, aggregate/bundle edges with counts and weights, show
cross-boundary edges first, distinguish unresolved edges, expose evidence on hover/inspect, and
test dense graphs with browser screenshots rather than only SVG existence.

### 3D/cityscape: currently a camera variant over the same extrusion

`cityscape` delegates node and link geometry to `tiles3d` and mainly adds a floor, camera controls,
and minimap (`packages/skins/cityscape/src/skin.ts:1-41`). This proves the skin seam, but does not
yet provide a distinct, semantically legible code-city language. The spatial meaning remains
primarily the 2D rank/order layout. At street level, rank becomes a direction rather than an
immediately readable relationship; the minimap is therefore load-bearing.

Risks:

- Tests cover object construction and camera math, not depth perception, label legibility,
  connector occlusion, or wayfinding.
- Distance culling reduces overlap but does not establish readable prioritization.
- The first-person metaphor consumes attention while semantics remain encoded in few channels.
- The 3D chunk is large enough to trigger a build warning; lazy-load it if 2D is the default.

Make 3D optional after the hierarchy is fixed. Revisit cityscape only after a real user can
answer, without the inspector: “what is this place, what depends on it, and what changed here?”

## Test and quality gaps

Missing high-value coverage:

- complete snapshot hierarchy invariants;
- deterministic grouping across repeated runs/provider variation;
- split/merge/move delta matching;
- graph-to-visible-edge rollups at every level;
- extractor-to-render integration on a realistic fixture;
- screenshot regression for dense 2D connectors;
- browser smoke tests for 3D selection, drill, ascend, camera switching, labels, and minimap;
- accessibility and keyboard navigation;
- valid-but-empty and low-confidence LLM grouping failures.

The suite passing proves implementation mechanics more than product correctness.

## Recommended execution order

### Phase 1 — Trustworthy model

1. Freeze terminology and the canonical tree contract.
2. Add tree validation; fail loudly on inconsistent parent/children data.
3. Separate deterministic structural levels from LLM architectural annotations.
4. Implement constrained, deterministic community candidates with quality metrics/fallback.
5. Add a real hierarchy fixture and repeated-run stability tests.

### Phase 2 — Trustworthy review deltas

1. Add hierarchy-aware matching and explicit split/merge classifications.
2. Add canonical edge rollups with provenance and per-level visibility policy.
3. Show grouping confidence, evidence, and architecture-only changes distinctly.

### Phase 3 — Scalable 2D

1. Add edge budgets, bundling, filtering, and evidence affordances.
2. Validate dense fixtures with browser screenshots.
3. Make search and breadcrumbs operate on the canonical hierarchy, not inferred regions.

### Phase 4 — Reassess 3D

1. Establish user tasks and visual acceptance criteria.
2. Keep 3D lazy-loaded and optional.
3. Implement only encodings that improve those tasks; remove decorative geometry without
   information value.

## Final assessment

This is a promising prototype with a sound extractor/schema direction and a usable 2D shell. Its
central failure is conceptual: it asks an LLM to decide the navigation hierarchy, then tries to
stabilize that decision with naming normalization and visual regions. That cannot support reliable
code comprehension or trustworthy commit/PR deltas.

Fix the canonical hierarchy and tree invariants first. Connector work and 3D work will then have
a stable semantic surface to render; before that, they are polishing an unstable map.
