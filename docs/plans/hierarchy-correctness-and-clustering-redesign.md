# Execution plan v7 — hierarchy correctness, then clustering redesign

**Status: APPROVED.** Seven review rounds; no remaining plan-level blockers. See Status at the end.

Supersedes v6 after a sixth NEEDS CHANGES review. All four points accepted: two were defects I
introduced in v6 (edge checks bolted onto a units-only validator; a stale audit count left in the
header after §3b was corrected), and the boundary-edge feature v6 added had behavior but no data
model. Decisions in force: real `group` kind; group work split into contracts/units (3a) and
migration (3b); test modules coverage-only, never LLM-analyzed.

**Fixed since the v7 review:** `boundary.direction` widened to `"in" | "out" | "both"` with
`inCount`/`outCount`, since one marker per external unit cannot otherwise describe a group that
both calls and is called by its sibling; per-direction markers were rejected because they would
duplicate `id` in `Scene.nodes` (§3a boundary edges).

**Fixed since v6:** `validateTreeInvariants` / `validateEdgeInvariants` / `validateSnapshotInvariants`
split by input, with `severity` on each finding reconciling "server load throws" against "legacy
rollups warn" (§2) · **boundary markers are real `SceneNode`s with a `boundary` field**, verified
cheap because no skin resolves link endpoints against `Scene.nodes` (§3a) · rollup provenance
invariants stated in the contract, not just the tests (§3a) · header audit count corrected to
51/17 (§ verification findings).

**Carried from v5→v6:** builder emits complete units, finalization only attaches · every
name-resolution failure fatal but the ungrouped bucket · split-over-merge precedence ·
`App.test.tsx` a rewrite, not a rename.

**Carried from v4→v5:** `hash.semantic` always computed · provenance omits `pass` ·
`buildGroupUnits` keyed on layer ids · Jaccard matching rules · `docs/design.md:84` synced ·
`rollupProvenance` on `EdgeSchema`.

## Context

Three reviews converge on one diagnosis: the navigation hierarchy driving zoom is LLM-authored
and structurally unsound, so every skin renders an unstable map. This plan executes the
remediation in dependency order, from documentation correctness through deterministic clustering.

### Verification findings

**Orphaned units, measured.** Across `.scv/snapshots/`:

| Snapshots | units | test modules | orphaned (`parent: null`) |
|---|---|---|---|
| `4b63222`, `06b0e56`, `7d97187`, `21bc1c6` | 304–306 | 47 | **47** |
| `c9152a1`, `e5574c3` | 503–528 | 75 | 0 (pre-date test exclusion) |

`isTestUnit` (`orchestrate.ts:122`) excludes test modules from Pass A (`:227`), clustering
(`:451`), leaf summaries (`:460`), and flowcharts (`:692`) — the intended coverage-only policy,
which stays. But exclusion from `unitsByFile` means no `parentOverride` entry (`:504`), so they
are never parented. Root policy must precede validation. Same sweep reconfirms
`nonModuleLayerChildren = 0` and `dangling = 0` in all six.

**A governing constraint on new delta statuses.** `schema/src/index.ts:260-262`: *"`moved` and
`renamed` are deliberately absent: they need rename-detection heuristics no differ here
implements, and a schema that permits a status nothing can emit reads as a capability the tool
does not have."* Split/merge must ship **with** the differ that emits them, never ahead of it.

**Artifact cache mechanism located.** `cli/src/artifacts.ts:104-140` `computeInputHash`, case
`"groups"` at `:123-130`, hashing layer id/name/why + edges + `promptRev`. `ArtifactDataMap`
(`:47`) types `groups: Unit[]` — the type survives the change from layer units to group units,
so nothing fails to compile and stale artifacts deserialize silently. A version constant is
mandatory, not cosmetic.

**`group` reference audit — 51 references, 17 files.** Earlier revisions of this plan said
17/9; that count swept only `src/` and undercounted by three times. The full sweep across `src/`
and `test/` is tabulated in §3b. Production sites: `layout/src/{scene,layout,flowchart}.ts`,
`ui/src/{App,Legend,Breadcrumb}.tsx`. The rest are fixtures, of which `ui/test/App.test.tsx`
(15 refs) is a rewrite rather than a rename.

**`package` and `config` are dead enum members** — declared in `UnitKindSchema` (`:7-17`),
constructed nowhere.

## Phase 0 — Correct the commentary

`docs/review/comments-comprehensive-review-2026-08-21.md` asserts a live rendering bug (layer
`children` holding functions). False: `orchestrate.ts:451` filters to `kind === "module"`,
corroborated by `metrics.modules` (:537) and the snapshot sweep. Amend the P0-3 section to state
upward-only reciprocity; **retain the false claim struck through** in "Corrections to these
comments". The document's value is auditable reasoning; silently rewriting destroys it.

## Phase 1 — Root and excluded-unit policy (v3 point 4; new point 2)

**Policy — single root.** One `kind === "system"` root; every other unit has a non-null parent.

**Test container kind (new point 2).** Add **`test_suite`** to `UnitKindSchema` alongside
`group`. Not `group`: a group is an LLM-derived architectural grouping of layers, and reusing it
for a structural, never-analyzed bucket recreates exactly the kind-overloading P1 objects to. A
distinct kind lets `NARRATABLE_KINDS`, the inspect queue, and skins exclude it by kind rather
than by path heuristics.

| Unit class | Placement | Kind | Analysis |
|---|---|---|---|
| Test modules | `u:tests:<repo>` container, `parent: sysId` | container is `test_suite`; members stay `module` | **None.** `semantics: null`, `provenance: { source: "static" }`. No Pass A/B/D, no flowcharts, excluded from inspect queue and `clusteringQuality`. Coverage only. |
| `package`, `config` | never constructed | **remove from `UnitKindSchema`**, and from `docs/design.md:84` | n/a |
| Layers, flows | parent to system | unchanged | unchanged |

The container is a full `Unit` (`hash.struct` over sorted member ids, `loc` union,
`metrics.modules`), so it validates like any other. UI renders it as a sibling of groups at
root, visually de-emphasized; drilling shows test modules with no semantics panel.

**Provenance shape** (review v5 point 2). `UnitProvenanceSchema` (`schema:92-95`) is
`{ source: "static" | "llm", pass: z.enum(["A","B","C","D"]).optional() }`. `pass` is *optional,
not nullable* — `pass: null` fails validation. The container therefore emits
`provenance: { source: "static" }` with `pass` omitted. No schema change: "no pass produced this"
is already expressible by absence, and widening the enum to accept `null` would add a second way
to say the same thing.

**Documentation sync** (review v5 point 5). `docs/design.md:84` spells the kind union out
verbatim — `"kind": "system|layer|module|package|class|function|api_flow|block|config"`. It is
updated in this same phase to drop `package`/`config` and add `group`/`test_suite`, so the doc
never disagrees with `UnitKindSchema`. The repo has no generated `.schema.json` fixtures (checked:
none exist), so `docs/design.md:84` is the only documentation site to sync.

**Test first**: zero `parent === null` except system; test modules parent to the container;
container in `system.children`; no test module in any layer's `children`; no test module reaches
Pass A/B/D.

## Phase 2 — Reciprocity, validation, and the reachability assertion (v3 points 2, 3; new point 7)

**Test first** (`interpreter/test/orchestrate.test.ts`): every layer and flow unit has
`parent === sysId`; **set equality both directions** between `system.children` and ids claiming
the system as parent; module `parent` still points at its layer; layer `children` all
`kind === "module"`.

**Implementation** — `orchestrate.ts:812-822`: hoist `sysId` above `newUnits`, then
`newUnits = [...layerUnits, ...flowUnits].map(u => ({ ...u, parent: sysId }))`. Also fix
`metrics.layers` (`:832`), which counts flow units as layers.

**Validators** — exported from `schema/src/index.ts`. Two functions over two inputs, not one
function that silently needs a third (review v7 point 1): the tree validator takes units and
knows nothing about edges; the edge validator takes edges plus the unit ids they must resolve
against. A snapshot-level wrapper runs both so callers have one entry point.

```ts
type Severity = "error" | "warning";
type Finding = { severity: Severity; type: string; unit?: string; edge?: string; detail?: string };

validateTreeInvariants(units: Unit[]): { valid: boolean; findings: Finding[] }
validateEdgeInvariants(edges: Edge[], unitIds: ReadonlySet<string>): { valid: boolean; findings: Finding[] }
validateSnapshotInvariants(snapshot: Snapshot): { valid: boolean; findings: Finding[] }   // runs both
```

`valid` is false only when a finding has `severity: "error"`, which is what separates a structural
defect from a legacy artifact — see the call-site table below. Structured findings, not throws;
`SnapshotSchema` is shape-validation and cannot express referential integrity.

Tree checks: one system root; no other null parent; parent/child ids resolve; reciprocity both
ways; acyclicity; **every unit reachable from the system and visited exactly once** (new point 7 —
a single DFS with a visit counter catches both orphans and diamonds);
**no `module` under a `test_suite` ancestor is also under a production layer**.

| Call site | File | On `error` findings | On `warning` findings |
|---|---|---|---|
| After `finalizeSnapshot` | `orchestrate.ts:893` | **Throw** — analyze-time is where this is a bug | **Throw too**: code this run just produced has no legacy excuse |
| Snapshot load (server) | `server/src/store.ts:96` | **Throw**, matching `parseOrThrow` | **Log and serve** — an old snapshot on disk must stay readable |
| Snapshot load / pre-diff (CLI) | `cli/src/diff.ts:33` | **Refuse to diff**, naming offending ids | **Log and diff** |

The two columns are what reconcile "server load throws" with "legacy bare rollups warn": severity
is a property of the *finding*, the call site only decides what to do with each. A broken parent
link is an `error` everywhere. A bare `rollup: true` with no `rollupProvenance` is a `warning` —
so it is fatal at analyze time, where only new code could have emitted it, and tolerated on load,
where it means the file predates the field.

**Behavioral risk.** `differ/src/diff.ts:140` seeds its rollup walk from `parent === null` roots;
today layers are roots *and* reachable via the system, so subtrees are walked twice. Pin
expected `amount`/`risk`/`sloc` totals **before** the change to expose double-counting.
`App.tsx:236` uses the same predicate for its no-focus fallback.

## Phase 3a — Group contracts and units (v3 points 1, 2, 5, 7, 8; new points 3, 4, 6, 8)

### Group semantics
`runPassCGroups` returns `{ groups, repaired }` (`pass-c.ts:155-170`) — names and memberships,
no what/how/why. **`semantics: null` initially**; a group-narration pass is deferred to its own
PR. Deriving prose by concatenating member-layer semantics produces text no human wrote and no
model endorsed.

### Hash contract, with normalization (new point 8)

| Field | Content |
|---|---|
| `hash.struct` | sha1 over sorted member-layer ids (`layerIdFor` pattern, `:502`) |
| `hash.semantic` | **always computed** — sha1 over normalized name + semantics, with absent semantics rendered as empty strings. Never `null`. |
| `hash.text` | `null` — groups have no own text |

**Normalization** (shared helper, `schema/src/normalize.ts`, reused by any future semantic hash):
NFC Unicode normalization → lowercase (`toLocaleLowerCase("en")`) → collapse internal whitespace
runs to one space → trim → strip trailing punctuation. Semantics fields are serialized in a fixed
key order (`what, how, when, where, why`), each null rendered as the empty string, joined by `\x1f`.
Deterministic and independent of JSON key insertion order.

Group **ids** derive from member ids only, never the name. Membership change ⇒ `hash.struct`
change; name-only change ⇒ `hash.semantic` change ⇒ `modified`.

**`hash.semantic` is never null** (review v5 point 1). An earlier draft said both "null while
semantics are null" and "a rename becomes `modified`" — mutually exclusive, since a null hash on
both sides compares equal and the rename disappears. Because groups ship with `semantics: null`
until the narration pass lands, a nullable semantic hash would make *every* group rename
invisible for exactly as long as that gap lasts. So the hash is always computed; empty semantics
contribute empty strings and the name alone drives it. Test: two snapshots differing only in a
group's name yield differing `hash.semantic` and a `modified` delta.

### Split/merge statuses (new point 1)
`UnitDeltaStatusSchema` (`:264-270`) permits only `added|removed|modified|risk_changed|unchanged`.
Honoring the `:260` rule that schema must not advertise uncomputable statuses, add a **structured
optional field** rather than new enum members:

```ts
relationship: z.object({
  kind: z.enum(["split", "merged"]),
  counterparts: z.array(z.string()),   // unit ids on the other side
}).optional()
```

Emitted only by the group matcher, which computes it from member-id overlap — the one place
membership lineage is actually known. Statuses stay as-is; a split group is `added` plus a
`relationship`, its predecessor `removed` plus the mirrored one. This lands **in the same PR as
the matcher**, per the `:260` rule.

**Matching rule** (review v5 point 4) — "member-id overlap" alone is not implementable. The
matcher is fully specified as:

1. **Identity first.** Equal `hash.struct` ⇒ same group; no `relationship`. Groups matched here
   are removed from both sides before anything below runs.
2. **Overlap measure.** For remaining old group `A` and new group `B`, Jaccard index
   `J = |A ∩ B| / |A ∪ B|` over member layer ids. Pairs with `J < 0.2` are not candidates —
   below that, "lineage" is coincidence.
3. **Split** — one old, many new. Old `A` is split when ≥2 new groups each satisfy
   `|A ∩ Bᵢ| / |Bᵢ| ≥ 0.5` (each successor is majority-composed of `A`'s members) and together
   they cover `≥ 0.5` of `A`. `A` is `removed` with `{ kind: "split", counterparts: [B₁…Bₙ] }`;
   each `Bᵢ` is `added` with `{ kind: "split", counterparts: [A] }`.
4. **Merge** — many old, one new. Mirror of 3 with the roles reversed: ≥2 old groups each
   majority-absorbed into one `B`. Each `Aᵢ` is `removed` with `{ kind: "merged", counterparts: [B] }`;
   `B` is `added` with `{ kind: "merged", counterparts: [A₁…Aₙ] }`.
5. **1:1 rename/drift.** Exactly one candidate on each side above threshold ⇒ `modified`, no
   `relationship` — this is the same group with churn, not a lineage event.
6. **Tie-breaking**, so the result is deterministic regardless of input order: candidates sort by
   `J` descending, then by `|A ∩ B|` descending, then by unit id ascending. A group already
   consumed by a split or merge is not reconsidered.
7. **Counterpart ordering.** `counterparts` is sorted by unit id ascending — never by score, so
   the array is stable across runs and diffable.

**Precedence** (review v6 point 4). v5 claimed rules 3 and 4 were "mutually exclusive by
construction" *and* supplied a fallback for when both apply — if the claim held the fallback
would be dead code, so the claim is dropped. Both can in fact fire: a reclustering that
simultaneously breaks up `A` and absorbs its pieces alongside another group's satisfies the split
test for `A` and the merge test for `B`. Explicit precedence, evaluated in order, before any
classification is emitted:

1. compute split candidates and merge candidates for the entire snapshot first;
2. **split wins over merge** when a group qualifies for both — a group that lost members
   describes its own history better than one that gained them, and split's counterpart list is
   the more informative of the two;
3. a group consumed by a split or merge is removed from both candidate pools, so no group
   receives two `relationship` values;
4. remaining above-threshold pairs fall through to rule 5 (`modified`).

Thresholds `0.2` and `0.5` are named constants with boundary tests, including one fixture where
split and merge both qualify and precedence decides.

### Schema compatibility (new point 6)
`schema: z.literal("scv/1")` (`:208`). Stay on `scv/1` as an additive extension, with the
guarantee stated in a schema comment and in `docs/design.md`:
- old snapshots parse under new code — **guaranteed**;
- new snapshots require the updated binary — a snapshot containing `group` or `test_suite` fails
  `UnitKindSchema` on older code;
- **no downgrade compatibility is promised.**

Update JSON schema fixtures. No migration script — `.scv/` is a rebuildable cache, and stale
snapshots are regenerated by re-analysis.

### CLI artifact pipeline and cache invalidation (v3 point 5; new point 3)
`analyze.ts:118-121` keys `layerUnitsByName` on `u.name` — an LLM string — so any rename silently
drops the group assignment. Fixes:
- the `groups` artifact returns **group units**, not grouped layer units; `ArtifactDataMap`
  (`artifacts.ts:47`) narrows to a `GroupsData { groupUnits: Unit[]; layerParent: [string, string][] }`
  so the shape change is a **compile error**, not a silent redeserialization;
- `finalizeSnapshot` gains `groupUnits: Unit[]`; **all layer matching keys on stable layer ids**;
- add `const ARTIFACT_SCHEMA_VERSION = "2"` in `artifacts.ts`, folded into `computeInputHash`'s
  `"groups"` case (`:123-130`) via `hashOf(..., ARTIFACT_SCHEMA_VERSION)`. Test: an artifact file
  written with the v1 hash is **recomputed, not reused**, asserted by stubbing the provider and
  observing a call.

### Group builder contract (new point 4)
One exported function, testable without a provider:

```ts
// Name->id resolution happens once, at the boundary. Throws on ambiguity OR unknown names.
resolveGroupMembership(
  groups: Record<string, string[]>,   // group name -> layer NAMES, as runPassCGroups returns
  layerUnits: Unit[],
): Record<string, string[]>           // group name -> layer IDS

buildGroupUnits(input: {
  layerUnits: Unit[];
  groups: Record<string, string[]>;   // group name -> layer IDS (post-resolution)
  systemId: string;
}): { groupUnits: Unit[]; layerParent: Map<string, string> }
```

**Layer names are not unique and nothing enforces it** (review v5 point 3). Verified: neither
`pass-b.ts` nor `pass-c.ts` contains any uniqueness, dedup, or collision-suffix logic, and
`orchestrate.ts:610-615` already builds a `Map<layerName, groupName>` today — so two layers
sharing an LLM-chosen name silently collapse, both inheriting the last writer's group. Carrying
`layerIdByName` into the new contract would have preserved that bug behind a new interface.

So `buildGroupUnits` takes **layer ids only**. `resolveGroupMembership` is the single conversion
point, and **every resolution failure is fatal** (review v6 point 2):

| Failure | Behavior |
|---|---|
| Duplicate layer name | **Throw** — names the colliding name and the ids sharing it, rather than picking a winner |
| Unknown layer name (model invented it) | **Throw** — names the unknown entries and the group that referenced them |
| Layer present but in no group | **Throw** — reported by `buildGroupUnits`' membership validation |

v5 had unknown names collected into a non-fatal `unresolved` list while a missing layer threw
later in the builder — two spellings of "the model's grouping does not match reality," with
opposite severities. All three are now fatal *before* snapshot construction, and every message
includes the offending names plus the raw Pass C output, so the failure is diagnosable without a
re-run. Repairing rather than failing is what produced the hierarchy this plan exists to fix.

- consumes layer **ids** directly; no name lookup remains inside the builder;
- group id = `layerIdFor`-style sha1 over sorted member-layer ids;
- `children` = member layer ids; **`parent` = `systemId`, set by the builder** — see ownership below;
- `metrics` = `{ layers, modules }` summed from members; `loc` = union of member files, summed sloc;
- **ungrouped bucket**: layers Pass C assigned to no group land in `u:group:ungrouped`, name
  `"Ungrouped"`, `provenance.source: "static"` — a fixed identity, so it never churns. This is
  the *only* non-fatal gap, and deliberately so: "the model grouped 12 of 14 layers" is a
  legitimate partial result, whereas a duplicate or invented name means the mapping cannot be
  trusted at all. The bucket is visible in the UI, so an over-full one is self-evident;
- **validated before returning**: every layer appears in exactly one group (the bucket included);
  no group is empty; every member id resolves to a real layer. Violations throw with the ids.

**Ownership** (review v6 point 1): the builder emits **complete** group units — `parent` set to
`systemId`, `children` set, hashes and metrics computed — and returns `layerParent` describing
how layers reparent onto them. `finalizeSnapshot` does no group construction; it only applies
`layerParent` to rewrite each layer's `parent` from `sysId` to its group id, and sets
`system.children` to groups + flows + the test container. v5 split parent assignment across both,
leaving no single owner. One rule: a unit leaves its builder complete, and finalization only
attaches.

### Edge visibility (v3 point 8)

| Focus | Visible edges |
|---|---|
| System | group→group rollups |
| Group | layer→layer within the group |
| Layer | module→module within the layer |
| Module | symbol edges |

Edges internal to the focused unit's children are hidden and surfaced as counts on the tile.
Rollups are computed from the canonical tree, not `loc.files[0]`.

**Boundary edges** (review v6 point 3) — the table above covers only edges whose endpoints are
both on screen. A layer inside the focused group that depends on a layer *outside* it would have
had no visible endpoint: its nearest common ancestor is the system, which is not rendered at
group focus. Since cross-group coupling is precisely what a reviewer opens a group to see,
hiding it would be the worst possible default. Rule:

> An edge with exactly one endpoint inside the focused subtree renders from the visible
> descendant to a **collapsed external endpoint** — the outside endpoint's highest ancestor that
> is a sibling of the focused unit (at group focus, the other group; at layer focus, the other
> layer).

**Data model** (review v7 point 2). `SceneLink.from`/`to` are node ids (`scene.ts:38-40`), so a
marker with no node has nowhere to attach. Verified how skins actually consume links:
`skins/tiles/src/link.ts:38-44` and `tiles3d/src/link.ts:21` render from `l.path` alone and use
`from`/`to` only as opaque strings for focus/hover comparison — **no skin resolves an endpoint
against `Scene.nodes`**. So the cheapest correct representation is a real node carrying a flag,
and existing link code keeps working untouched:

```ts
// scene.ts — SceneNode gains one optional field.
// Present only on collapsed external endpoints (boundary markers). The node is not a unit in
// the focused subtree; `id` is the off-screen unit it stands for, so navigation is a plain
// drill to `id` and focus/hover comparisons already match.
boundary?: {
  edgeCount: number;    // total contributing edges, in + out
  weight: number;       // summed contributor weight, in + out
  direction: "in" | "out" | "both";
  inCount: number;      // contributing edges pointing into the focused subtree
  outCount: number;     // ...and out of it; inCount + outCount === edgeCount
};
```

**Why `"both"` and not one marker per direction** (review v8). Collapsing every edge to an
external ancestor into one marker is what keeps the frame readable, but a two-value `direction`
cannot describe a group that both calls and is called by its sibling — the common case for any
two groups that genuinely interact. The alternative, a marker per direction, would put two nodes
with the **same `id`** in `Scene.nodes`, breaking `data-id` uniqueness and the drill-by-id path
that makes markers cheap in the first place. So one marker per external unit stays the rule, and
`direction` widens.

`inCount`/`outCount` keep the merge lossless: a skin can render an arrow head per direction, or
weight the glyph by the dominant one, without re-deriving anything from the link list.
`direction` is `"both"` iff both counts are non-zero, and is redundant with them by construction —
it exists so the common render path is a switch rather than two comparisons.

| Concern | Resolution |
|---|---|
| Identity / target | `SceneNode.id` **is** the external unit's id — the sibling group or layer. No synthetic id space, so `data-id`, search, and drill all work unchanged |
| Positioning | `layout.ts` places markers after the main pass, clamped to the frame edge on the side nearest their real endpoint, spread along that edge to avoid overlap. `w`/`h` are a fixed marker size; `depth` is the focused unit's depth |
| Geometry | `sides: 4`, `ring: false`, `heat` from the external unit — markers read as tiles, deliberately: a skin with no boundary support still renders something meaningful and correctly placed |
| Hit testing / navigation | None needed beyond what exists. A marker is a node, so the existing double-click-to-drill path navigates to the external unit |
| 2D / 3D / cityscape | All three inherit correct-but-plain rendering for free. Only `tiles` gets explicit styling in this phase (dimmed fill, `edgeCount` badge, name label); 3D and cityscape are follow-ups, not blockers |

`Scene.nodes` therefore may contain nodes outside the focused subtree — the one place that is
true. Any consumer assuming otherwise must filter on `boundary === undefined`; the audit for that
assumption is part of this phase.

Multiple edges to the same external ancestor collapse into one marker. This keeps the
one-rollup-per-relationship rule intact: an edge is drawn either fully inside the focus, or once
to a boundary marker, never both. Group↔layer edges are still never emitted.

Tests: focus a group whose layer calls out to another group, and assert exactly one marker
addressed to the sibling group with the contributing count; a marker's `id` resolves to a real
unit; drilling a marker focuses that unit; two edges to the same external group produce one
marker with `edgeCount: 2`; a scene with no cross-boundary edges produces none; **an
outbound-only marker is `"out"` with `inCount: 0`, and an inbound-only one mirrors it**; and
**a bidirectional pair — the focused group calling a sibling and being called back — yields
exactly one marker with `direction: "both"`, `inCount: 1`, `outCount: 1`, `edgeCount: 2`, and no
duplicate `id` in `Scene.nodes`** (review v8). That last assertion is the one that fails under
either rejected design.

**Rollup provenance needs a schema field** (review v5 point 6). Verified: `EdgeSchema:155` has
only `rollup: z.boolean().optional()` — a bare flag with no payload — and `evidence`
(`EvidenceSchema:141-144`) is `{ file, line }[]`, which cannot express "these 14 call edges
became this one group→group edge." Add a sibling field rather than overloading `evidence`, whose
meaning (a source location a human can open) stays intact:

```ts
// Present iff `rollup` is true: which concrete edges this aggregate stands for.
rollupProvenance: z.object({
  edges: z.array(EdgeId),        // contributing edge ids, sorted ascending
  count: z.number().int(),       // == edges.length; explicit so consumers need not derive it
  weight: z.number(),            // summed weight of contributors
}).optional(),
```

**Optional in the schema, mandatory at the producer** (review v6 point 5). The field stays
`.optional()` on `EdgeSchema` so existing snapshots with bare `rollup: true` still parse — that
is the compatibility guarantee above, and a Zod refinement requiring the pair would break every
snapshot in `.scv/`. Enforcement therefore lives where new edges are made, not in the schema:

`validateEdgeInvariants` (Phase 2) owns the check. Its contract, stated as invariants rather
than left to the tests (review v7 point 4) — for every edge with `rollup === true`:

| Invariant | Severity |
|---|---|
| `rollupProvenance` present | `warning` — absent means a legacy edge; fatal at analyze time only |
| `edges` is non-empty | `error` |
| `edges` contains no duplicates | `error` |
| `edges` is sorted ascending | `error` — canonical order, so two runs byte-compare |
| every id in `edges` resolves to a real edge | `error` |
| `count === edges.length` | `error` |
| `weight` equals the summed weight of the contributors | `error` |
| no contributor is itself a rollup | `error` — rollups never nest; each is one hop from concrete edges |

An edge with `rollupProvenance` but `rollup !== true` is also an `error`; the flag and the payload
travel together. The producer therefore cannot emit a bare or inconsistent new rollup, while no
user is locked out of an old snapshot.

Consumers to update: `orchestrate.ts:846-881` (the only producer), the inspector's edge panel, and
any skin that renders edge weight — `count` is what makes "14 calls" renderable on a tile instead
of an opaque summed weight. Tests: each invariant above, plus a bare new rollup throwing at
analyze time and a legacy bare rollup loading with a warning.

## Phase 3b — Deltas, layout, and UI migration (v3 points 3, 6; new point 5)

### Group risk policy
`diff-with-risk.ts:11` sets `NARRATABLE_KINDS = new Set(["module"])`, excluding layer/system as
"LLM-invented groupings whose identity churns." Groups are *more* LLM-derived. Groups and
`test_suite` appear in `unit_deltas` and rollups, receive **no Pass D narration**, and stay **out
of the inspect queue**. State it in the `:5-9` comment beside the existing exclusions.

### Scene and layout migration — full audit, **51 references / 17 files**

Re-run while addressing review v6 point 6, and the scope is three times what v5 recorded (17/9).
Four further test files no review named: `layout/test/layout.test.ts` (8 refs — the largest after
`App.test.tsx`), `ui/test/scene3d.test.ts`, `ui/test/Canvas3dHost.test.tsx`,
`interpreter/test/orchestrate.test.ts`, `schema/test/validator.test.ts`. Every prior count was an
undercount because the greps only swept `src/`. The table below lists the production changes; the
test files follow the same mechanical rename except `App.test.tsx`.

| File | Change |
|---|---|
| `layout/src/scene.ts:19` | `SceneNode.group: string` → `groupId: string` (group unit id) |
| `layout/src/scene.ts` (`SceneNode`) | add optional `boundary` field — see §3a boundary edges |
| `layout/src/layout.ts` (post-pass) | emit boundary markers, clamped and spread along the frame edge |
| `skins/tiles/src/node.ts` | render `boundary` markers: dimmed fill, count badge, name label, and a direction glyph driven by `direction`/`inCount`/`outCount` |
| `layout/src/scene.ts:28-29` | `Region.id` becomes the group **unit id**; `name` keeps display name |
| `layout/src/layout.ts:74-77` | `groupOf` walks to nearest layer, then that layer's group *unit*, not `layer.group` |
| `layout/src/layout.ts:94-108` | `regionsFor` buckets by `groupId`; the 2+-layer rule (`:103`) unchanged |
| `layout/src/layout.ts:180` | `group: groupOf(...)` → `groupId:` |
| `layout/src/flowchart.ts:169` | `group: ""` → `groupId: ""` |
| `ui/src/{App,Legend,Breadcrumb}.tsx` | read the group unit via parent chain |
| `skins/{tiles3d,tiles,cityscape}/test/*` | fixture `SceneNode`s updated to `groupId` |
| `ui/test/Legend.test.tsx` (:65-99) | fixtures drop `group: "api surface"` from `makeUnit`; assert grouping from real group units |
| `ui/test/CanvasHost.test.tsx` (:70-85) | same fixture change; the 2+-layer region rule still holds via `groupId` |
| `ui/test/App.test.tsx` (:120-205, :376-389, :531-585) | **rewrite, not rename** — see below |
| `layout/test/layout.test.ts` | 8 refs — `groupOf`/`regionsFor` fixtures move to `groupId` |
| `ui/test/{scene3d,Canvas3dHost}.test.ts{,x}` | `SceneNode` fixtures updated |
| `interpreter/test/orchestrate.test.ts` | layer fixtures drop the `group` string |
| `schema/test/validator.test.ts` | unit fixture drops `group`; add the new kinds |

**`App.test.tsx` is a rewrite** (review v6 point 6). It does not merely carry `group:` strings; it
asserts the synthetic domain tier this plan retires — `group:api surface` ids at `:376-389`, and
`:531` *"groups the system's layer children by their group field into a synthetic domain tier at
the root"* with drill/ascend coverage through `:585`. Those tests encode the old design as
expected behavior, so renaming the field would leave them asserting a tier that no longer exists.
They are rewritten in the same PR that deletes `buildDomainUnits`/`domainId`/`isDomainId`
(`App.tsx:37-63`, used at `:213`, `:225`), against real group units with real ids. The
`makeUngroupedSnapshotWithDeepLeafEdges` case (`:252-273`, deliberately group-less) becomes the
`u:group:ungrouped` bucket case.

**Acceptance:** `npm run lint` and `npm test` pass with zero remaining `\.group\b` matches under
`packages/*/src`, `packages/*/test`, and `packages/skins/*/test`, and zero `group:` id literals in
UI tests (the audit grep is the check). Because `SceneNode`
is a typed interface, the rename is compiler-enforced across skins — no silent misses.

Drilling below a group keeps its region valid: `groupId` resolves by ancestry at any depth.

### Deltas, flows, retirement
`DeltaSchema` carries `unit_deltas` (:315) and `rollup` (:317), so group units flow in once real.
Add stable matching via the member-id hash, the `relationship` field above, and a test that a
renamed group with unchanged membership is `modified`.

`App.tsx:237` already filters `api_flow` from the structural tree with an explicit comment and
`:277` collects flows for the Flows view — deliberate, and it stays. Root shows groups + test
container; focusing a group shows its layers; Flows unaffected.

**Retire in one PR**: `buildDomainUnits`, `domainId`, `isDomainId` (`App.tsx:34-75`), the
`group:` prefix in `Breadcrumb.tsx:20-21`, and `group` on `UnitSchema` (:136-138). Leaving both
paths live is the ambiguity this work exists to remove.

## Phase 4 — Clustering

### 4a. Measurable partition quality
`checker.ts:139-149` `modularity()` has no penalty for cluster count or imbalance — one giant
cluster scores 1.0. Keep it; add `clusteringQuality(clusters, edges)` returning modularity plus
cluster count, size distribution, imbalance. Test: a degenerate and a good partition both score
1.0 modularity yet separate on the new fields.

### 4b. Adversarial fixture
`fixtures/cluster-quality-adversarial/`: a directory with two unrelated modules, one conceptual
module spanning directories, a package boundary, generated and test code, a cycle, a high-fan-in
utility. Built **before** the algorithm; asserted automatically, never eyeballed.

### 4c. Deterministic partition — acceptance criteria
Replaces the merges-over-directory-buckets contract (`pass-b.ts:90-114`), which cannot split a
directory. Not done until all hold as tests:
1. identical structural input ⇒ byte-identical membership and ids;
2. provider/LLM variation changes names and prose only, never membership;
3. directory-baseline fallback is itself deterministic;
4. singleton and giant-cluster thresholds are named constants with boundary tests;
5. split/merge across revisions is explicit in deltas (via `relationship`);
6. 4b expectations asserted in CI.

**Provenance.** Seed, algorithm id, tie-breaking rule, algorithm version persist in snapshot
provenance so a re-analysis explains why a boundary moved. LLM contributes naming only, recorded
separately — the same split applied to groups in 3a.

Weeks, not days. Its own PR sequence; Phases 0–3 must not wait on it.

## Phase 5 — Follow-up

2D edge budgets and bundling per the original review; 3D/cityscape reassessment once user tasks
and visual acceptance criteria exist. The `cityscape`→`tiles3d` geometry delegation is deliberate
(`skins/cityscape/src/skin.ts:8-19`), not a defect. The 3D chunk is already lazy-loaded
(`App.tsx:1-10`); no bundle work outstanding.

## Files

`interpreter/src/orchestrate.ts` (:122, :227, :440-544, :812-845, :893) ·
`interpreter/src/pass-c.ts` (:155-170) · `interpreter/src/pass-b.ts` ·
`interpreter/src/checker.ts` (:139+) ·
`schema/src/index.ts` (:7-17, :92-95 provenance, :112-139, :146-167 `EdgeSchema`, :208, :264-270) ·
`docs/design.md` (:84 kind union) ·
new `schema/src/normalize.ts` · `cli/src/artifacts.ts` (:17-49, :104-140, :181-196) ·
`cli/src/analyze.ts` (:110-135) · `cli/src/diff.ts` (:33) · `server/src/store.ts` (:96) ·
`differ/src/diff.ts` (:140) · `differ/src/diff-with-risk.ts` (:5-21) ·
`layout/src/{scene,layout,flowchart}.ts` · `ui/src/{App,Legend,Breadcrumb}.tsx` ·
`skins/{tiles,tiles3d,cityscape}/test/*` ·
`ui/test/{App,Legend,CanvasHost,Canvas3dHost,scene3d}.test.ts{,x}` · `layout/test/layout.test.ts` ·
`interpreter/test/orchestrate.test.ts` · `schema/test/validator.test.ts` ·
`docs/review/comments-comprehensive-review-2026-08-21.md`

## Verification

Per phase: `npm test` and `npm run lint` (never bare executables). TDD throughout — each phase
starts RED, per CLAUDE.md.

After Phase 1, re-run the snapshot sweep: zero `parent === null` except the system in every
snapshot. After 3a, assert the stale-artifact test recomputes rather than reuses. After 3b, the
audit grep returns zero `\.group\b` hits. End-to-end: analyze `fixtures/orderly`, then
`npm run dev` and confirm drill/ascend traverse system → group → layer → module → function,
breadcrumbs show real group names, Legend renders, Flows unaffected, test container present and
de-emphasized. Diff two revisions before and after 3a to confirm group promotion did not turn
stable groups into remove/add churn.

Git: one branch per phase — `docs/review-comment-correction`, `feature/root-policy`,
`feature/tree-reciprocity-validation`, `feature/group-contracts-units`, `feature/group-migration`,
then the clustering sequence. Branch → implement → verify → `project-review` → PR. Never commit
to main.

## Status

**APPROVED 2026-08-21 (v7)** after seven review rounds. No remaining plan-level blockers: the
reviewer confirmed `direction` supports `"in" | "out" | "both"`, `inCount + outCount ===
edgeCount`, bidirectional interactions stay one unique marker, tests cover both directions and id
uniqueness, tile migration includes directional rendering, and the validator, provenance,
boundary-node, and 51/17 audit contracts are mutually consistent.

No phase implemented yet. The docs are landing now on `docs/review-and-plan`; Phase 0 follows on
its own branch.

**Landing order for the docs (decided).** Two PRs, not one:

1. `docs/review-and-plan` — add the plan doc and both review docs **verbatim, unmodified**, plus
   the `docs/plans/README.md` row.
2. `docs/review-comment-correction` — apply the Phase 0 correction on top.

Splitting them is what makes Phase 0 legible: the review docs land as they were actually received,
so the correction to the false P0-3 claim appears as a reviewable diff against the original text
rather than being folded invisibly into the same commit that introduces the file. The Phase 0
principle — that this document's value is auditable reasoning, and silently rewriting it destroys
that — applies to its git history too.
