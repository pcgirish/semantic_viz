# implement-serve — stack, layout, milestones

> Design intent in [`serve.md`](serve.md).

## Stack

| Concern | Choice | Why |
|---|---|---|
| Server | **Fastify** on Node 24+ | Same runtime as the analyzer. In practice split into two `scv` CLI commands — `scv serve` (JSON API) and `scv ui` (static SPA + `/api/*` proxy) — rather than one merged process |
| Index | `better-sqlite3` | Shared with the analyzer — `.scv/index.sqlite`, one file, no daemon |
| UI | **React 18 + TypeScript + Vite** | |
| 2D rendering | **SVG** to ~800 nodes, **Canvas 2D** above | SVG gives free hit-testing and CSS transitions; Canvas is the escape valve. Both consume `Scene`, so the switch is invisible |
| 3D skin | **three.js** | `tiles3d` only, lazy-chunked. Never loaded unless selected |
| Layout | **Hand-written** — see below | |
| State | **Zustand** | Selection, focus, mode, rev are four small orthogonal slices |
| Styling | **CSS custom properties + CSS Modules** | Skins swap by re-binding custom properties |
| Animation | **Motion One** (WAAPI) | Replay transitions run off the main thread |
| Test | `vitest` + Playwright | |

### Why hand-written layout

d3-hierarchy does not do layered DAGs. dagre is unmaintained and gives no control over lane assignment. ELK is a Java port, heavy, and its routing is a black box.

The routing rules in [`serve.md`](serve.md#edge-routing--the-mocks-real-defect) — lane assignment, bundling, density gating — plus position seeding for stable replay are *the* differentiating work of the visualizer. They are not something to fight a library over. The engine is a few hundred lines of ranking, barycentre sweeps, and channel routing, it is pure, and it is unit-testable without a DOM.

### Why not React Flow / Cytoscape / Sigma

All of them own layout, and layout is the product. They would be adopted to render `Scene` and then fought for control of node positions. Rendering `Scene` is the easy half.

---

## Package layout

```
packages/
  server/          Fastify: snapshot/delta API, unit search (wired into the CLI as `scv serve`)
  cli/             `scv serve` (JSON API) / `scv ui` (static SPA + /api proxy) entrypoints
  layout/           ← pure, no DOM, no React
    rank.ts         longest-path ranking
    order.ts        barycentre sweeps + deterministic tiebreak
    place.ts        nested boxes, √-area sizing
    route.ts        channels, lane assignment, bundling
    seed.ts         position seeding from prior snapshot
    scene.ts        Scene type — the skin contract
  skins/
    tiles/  tiles3d/          each exports {node, link, theme, camera, navigate}
  ui/               canvas host, tray, rails, timeline, inspect queue
```

`layout` imports nothing from `ui`. That boundary is what makes 3D a skin and not a fork; if a skin ever needs to import from `layout` to reposition something, the encoding belongs in `layout`.

## API

```
GET /api/revs                          timeline: sha, author, kind, amount
GET /api/snapshot/:sha                 full UnitGraph
GET /api/snapshot/:sha/unit/:id        one unit + resolved neighbours
GET /api/delta/:from/:to               DeltaGraph  (from = parent sha or merge base)
GET /api/delta/:from/:to/queue         inspect queue only — cheap, loads first
GET /api/search?q=                     unit search over the sqlite index
GET /api/layout/:sha/:skin             cached positions
PUT /api/layout/:sha/:skin             persist after relayout
```

`queue` is separate from `delta` because in Delta mode the queue is what the user reads first and the graph is what they read second. It should not wait on a megabyte of unit deltas.

---

## Milestones

| M | Deliverable | Exit criterion |
|---|---|---|
| **V1** | Server + API over A6 output | Serves the `orderly` snapshots and deltas; search returns a unit in <50 ms |
| **V2** | Layout engine: ranking, dummy-node expansion, port spreading, lane routing, bundling | **<5% crossing pairs on a 200-node graph; relayout <100 ms**; pure-function tests, no DOM |
| **V3** | `tiles` skin — sides-as-complexity, nested mini-map, density gating, hover trace | Full traversal system → function; the four complexity buckets readable at a glance |
| **V4** | Inspector tray | Every Unit field surfaced; low confidence visually distinct |
| **V5** | Delta mode + inspect queue + rev picker | Queue drives navigation; rollup makes hot leaves visible from the system view |
| **V6** | Replay with seeded layout | 50-rev replay, zero node teleporting |
| **V7** | `tiles3d` | Zero changes under `layout/` — done |
| **V8** | Depends-on view | Depth rows, `reached_by`, transitive sizing |
| **V9** | Flows view | Entry points enumerated from `api_flow` units; step detail; delta status per step |

### V2 is measured, not asserted

The mock's layout engine is tested headless (jsdom, no rendering) against both the real fixture and synthetic layered graphs. Current numbers:

| Graph | Crossings | Relayout |
|---|---|---|
| `orderly` system view (6 nodes, 6 bundles) | **0** | <1 ms |
| `orderly` domain layer (7 nodes, 7 bundles) | 2 | <1 ms |
| synthetic, 200 nodes / 193 bundles | 7.7% of pairs | 41 ms |
| synthetic, 400 nodes / 400 bundles | 8.3% of pairs | 107 ms |

Getting here took four fixes, in descending order of impact:

1. **Cap tile width and centre rows.** A lone node in a row was stretching to the full canvas, leaving no gap for a skip-level edge to pass through.
2. **Dummy-node expansion.** An edge spanning three ranks now participates in the ordering of every row it passes through instead of cutting across them.
3. **Port spreading.** Edges fan across a node's top and bottom borders instead of all converging on its centre pixel.
4. **Two-pass lane assignment.** Lane *index* is packed first; lane *y* is distributed once the channel's lane count is known. Assigning y during packing collapses lanes onto each other as soon as a channel needs more than it has pixels.

**The 5% target is met on real code but not on adversarial random graphs.** Two things were tried and rejected: the transpose step (greedy adjacent swaps) cost 5× the runtime for no crossing reduction, which says the residual crossings are geometric rather than ordering-related; and median barycentre in place of mean, which was neutral.

The known remaining fix is **Brandes–Köpf x-coordinate assignment**, which aligns each dummy chain vertically with its endpoints instead of the current greedy nearest-free-slot nudging. That is the correct next step for V2 and is where the residual 7% lives. Whether it is worth it depends on whether real repos ever produce the density the synthetic case does — `orderly` does not, and the clustering cap in the open question below is designed to make sure larger ones do not either.

V7 is the load-bearing test of the architecture. If `tiles3d` requires touching `layout/`, the skin abstraction is a fiction and it is better to find that out at V7 than after four skins exist.

---

## Performance budget

| Graph | Target |
|---|---|
| ≤200 nodes | SVG, <100 ms relayout, 60 fps hover |
| ≤800 nodes | SVG, <300 ms relayout |
| >800 nodes | Canvas 2D, <500 ms relayout; virtualize below the fold |

A single view never renders more than one level of children below the focus. Depth comes from drilling, not from rendering the whole tree — the mini-map is a thumbnail, not a live sub-render.

---

## Open question, for after the visual pass

The system view of `orderly` has six layers, which is near the comfortable ceiling for tile sizing. Real repos will cluster into 15+.

Two candidate answers, and this is a product decision rather than an engineering one:

1. **Cap the top level.** Pass B targets 5–9 layers and nests the rest, so the outermost view is always scannable and depth is always one drill away.
2. **Add a grouping level above layers.** Honest to large systems, but adds a tier to the hierarchy and a concept to the vocabulary.

Option 1 is cheaper and keeps the vocabulary at one recursive Unit type. It is also a constraint the Interpreter can be told about directly, which makes it testable. Recommendation is 1, revisited if a real repo makes it look silly.
