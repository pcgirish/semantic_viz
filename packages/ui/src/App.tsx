import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Delta, Edge, Snapshot, Unit } from "@scv/schema";
import type { BoundaryEdge } from "@scv/layout";
import { SegmentedControl, Select, Toolbar, Tray } from "@scv/design-system";
import { Breadcrumb } from "./Breadcrumb.js";
import { CanvasHost, type TileDeltaInfo } from "./CanvasHost.js";
import { UnitSearch } from "./UnitSearch.js";
import { ControlsHelp } from "./ControlsHelp.js";
import { applyEdgeBudget, rollUpEdges, DEFAULT_EDGE_BUDGET } from "./edge-budget.js";
// Lazy: three.js is ~570kB of the bundle and only the 3D skins need it, so a user who
// never leaves the 2D view never downloads it.
const Canvas3dHost = lazy(async () => ({ default: (await import("./Canvas3dHost.js")).Canvas3dHost }));
import { DependsOn } from "./DependsOn.js";
import { EntryPointsRail } from "./EntryPointsRail.js";
import { Flowchart } from "./Flowchart.js";
import { Flows } from "./Flows.js";
import { Inspector } from "./Inspector.js";
import { InspectQueue } from "./InspectQueue.js";
import { Legend } from "./Legend.js";
import { Replay, shortSha } from "./Replay.js";
import { useAppStore, type RenderSkin } from "./store.js";

export type AppProps = {
  /** Full snapshot URL, e.g. /api/snapshot/:sha (implement-serve.md's API table). */
  snapshotUrl: string;
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "loaded"; snapshot: Snapshot };

type RevSummary = { sha: string; kind: string; pr?: number; message?: string; ts: string; author: string; author_kind: string; amount: number };

function shaFromSnapshotUrl(url: string): string {
  return url.split("/").pop() ?? "";
}

/**
 * Maps every unit to whichever visible unit is its nearest ancestor, so edges between real
 * leaf units (module/function, arbitrarily nested) roll up to the tile actually shown —
 * used both for the synthetic domain tier and the plain layer tier at root. Ownership is
 * "children" (a layer's own `children` list), not `unit.parent` — this snapshot format
 * links containers to members via `children` and leaves member `.parent` unset, so walking
 * `.parent` alone misses everything.
 */
export function buildUnitToAncestor(visibleUnits: Unit[], unitsById: Map<string, Unit>): Map<string, string> {
  const childToVisible = new Map<string, string>(visibleUnits.flatMap((v) => v.children.map((childId): [string, string] => [childId, v.id])));
  for (const v of visibleUnits) childToVisible.set(v.id, v.id); // a visible unit is its own nearest ancestor
  const cache = new Map<string, string | undefined>();
  const resolve = (unitId: string): string | undefined => {
    if (cache.has(unitId)) return cache.get(unitId);
    cache.set(unitId, undefined); // break cycles defensively
    const direct = childToVisible.get(unitId);
    const unit = unitsById.get(unitId);
    const result = direct ?? (unit?.parent ? resolve(unit.parent) : undefined);
    cache.set(unitId, result);
    return result;
  };
  const result = new Map<string, string>();
  for (const id of unitsById.keys()) {
    const ancestor = resolve(id);
    if (ancestor) result.set(id, ancestor);
  }
  return result;
}

/**
 * Finds the edges with exactly one endpoint inside the focused subtree, and resolves each one's
 * outside endpoint to the focused unit's *sibling* that contains it — at group focus, the other
 * group; at layer focus, the other layer.
 *
 * Without this, cross-boundary coupling simply vanishes: the endpoints' nearest common ancestor
 * is the system, which is not rendered at group focus, so the edge has no visible endpoint and
 * gets dropped. Cross-group coupling is precisely what a reviewer opens a group to see.
 */
export function collectBoundaryEdges(input: {
  focusedUnit: Unit;
  visibleUnits: Unit[];
  edges: Edge[];
  unitsById: Map<string, Unit>;
}): { boundaryEdges: BoundaryEdge[]; externalUnits: Unit[] } {
  const { focusedUnit, visibleUnits, edges, unitsById } = input;

  // Siblings of the focused unit are the collapse targets. At root the focused unit has no
  // parent, so there are none — and correctly so: nothing is outside the system.
  const parent = focusedUnit.parent ? unitsById.get(focusedUnit.parent) : undefined;
  const siblingIds = new Set((parent?.children ?? []).filter((id) => id !== focusedUnit.id));
  if (siblingIds.size === 0) return { boundaryEdges: [], externalUnits: [] };

  const insideIds = descendantIds(focusedUnit, unitsById);
  const toVisible = buildUnitToAncestor(visibleUnits, unitsById);
  const toSibling = buildUnitToAncestor([...siblingIds].map((id) => unitsById.get(id)!).filter(Boolean), unitsById);

  const boundaryEdges: BoundaryEdge[] = [];
  const externalUnits = new Map<string, Unit>();
  for (const e of edges) {
    const fromInside = insideIds.has(e.from);
    const toInside = insideIds.has(e.to);
    if (fromInside === toInside) continue; // wholly inside, or wholly outside

    // A crossing edge whose inside endpoint has no visible tile has nothing to draw from.
    const insideEndpoint = fromInside ? e.from : e.to;
    const interior = toVisible.get(insideEndpoint);
    if (!interior) continue;

    const external = toSibling.get(fromInside ? e.to : e.from);
    const externalUnit = external ? unitsById.get(external) : undefined;
    if (!externalUnit) continue; // outside the focus but under no sibling — nothing to collapse onto

    externalUnits.set(externalUnit.id, externalUnit);
    // `interior` is the tile the edge actually attaches to on screen. Keeping it (rather than
    // using it as a filter and discarding it) is what lets the tray say *which* tiles a sibling
    // couples to — the external endpoint is deliberately not a visible unit, so nothing
    // downstream could re-derive it.
    boundaryEdges.push({ edge: e, external: externalUnit.id, interior, direction: fromInside ? "out" : "in" });
  }

  return { boundaryEdges, externalUnits: [...externalUnits.values()] };
}

/** One participating interior tile within a tray row: how strongly, and which way, it couples. */
export type SiblingTileLink = {
  /** Visible interior tile id. */
  interior: string;
  /** Crossing edges between this tile and this sibling. */
  edgeCount: number;
  /** Summed `edge.weight` across those edges, for connector stroke weight. */
  weight: number;
  /** This tile's own direction — independent of the row's: a row can be "both" while each of
   *  its tiles is purely "in" or purely "out". */
  direction: "in" | "out" | "both";
};

/** One row of the connected-siblings tray: a sibling of the focused unit, and what it touches. */
export type SiblingSummary = {
  /** Sibling unit id. Not necessarily a `layer` — siblings are whatever kind the focused unit
   *  is, so this is deliberately kind-agnostic. */
  id: string;
  name: string;
  /** One entry per participating interior tile, sorted by `edgeCount` descending. Empty for a
   *  sibling with no crossing edges. */
  tiles: SiblingTileLink[];
  inCount: number;
  outCount: number;
  /** Total crossing *edges* — `sum(tiles[].edgeCount)`, not `tiles.length`. */
  edgeCount: number;
  /** `null` for a zero-link sibling: it has no direction, and must not be defaulted to one. */
  direction: "in" | "out" | "both" | null;
};

function mergeDirection(current: "in" | "out" | "both" | null, next: "in" | "out"): "in" | "out" | "both" {
  if (current === null) return next;
  return current === next ? current : "both";
}

/**
 * Aggregates the crossing edges into one row per sibling of the focused unit, for the
 * connected-siblings tray.
 *
 * Every sibling gets a row, including those with no crossing edges: "not coupled" and "not
 * shown" are different answers, and the boundary-marker column this replaced could only say the
 * latter. Kept separate from `externalUnits` deliberately — that feeds `buildScene`, and the
 * tray is a DOM overlay, not scene geometry.
 */
export function summariseSiblings(input: {
  focusedUnit: Unit;
  boundaryEdges: BoundaryEdge[];
  unitsById: Map<string, Unit>;
}): SiblingSummary[] {
  const { focusedUnit, boundaryEdges, unitsById } = input;
  const parent = focusedUnit.parent ? unitsById.get(focusedUnit.parent) : undefined;
  const siblingIds = (parent?.children ?? []).filter((id) => id !== focusedUnit.id && unitsById.has(id));
  if (siblingIds.length === 0) return [];

  type TileAcc = { edgeCount: number; weight: number; direction: "in" | "out" | "both" };
  const byExternal = new Map<string, Map<string, TileAcc>>();
  const counts = new Map<string, { inCount: number; outCount: number }>();
  for (const { edge, external, interior, direction } of boundaryEdges) {
    const tiles = byExternal.get(external) ?? new Map<string, TileAcc>();
    const acc = tiles.get(interior) ?? { edgeCount: 0, weight: 0, direction };
    acc.edgeCount += 1;
    acc.weight += edge.weight ?? 1;
    acc.direction = mergeDirection(acc.direction, direction);
    tiles.set(interior, acc);
    byExternal.set(external, tiles);

    const c = counts.get(external) ?? { inCount: 0, outCount: 0 };
    if (direction === "in") c.inCount += 1;
    else c.outCount += 1;
    counts.set(external, c);
  }

  const rows = siblingIds.map((id): SiblingSummary => {
    const unit = unitsById.get(id)!;
    const { inCount, outCount } = counts.get(id) ?? { inCount: 0, outCount: 0 };
    const tiles = [...(byExternal.get(id) ?? new Map<string, TileAcc>())]
      .map(([interior, acc]): SiblingTileLink => ({ interior, ...acc }))
      // Descending by edgeCount, then by id so the order is stable across renders — the
      // highlight's anchor tile is tiles[0], so an unstable sort would flicker it.
      .sort((a, b) => b.edgeCount - a.edgeCount || a.interior.localeCompare(b.interior));
    return {
      id,
      name: unit.name,
      tiles,
      inCount,
      outCount,
      edgeCount: inCount + outCount,
      direction: inCount > 0 && outCount > 0 ? "both" : inCount > 0 ? "in" : outCount > 0 ? "out" : null,
    };
  });

  return rows.sort((a, b) => b.edgeCount - a.edgeCount || a.name.localeCompare(b.name));
}

/** The focused unit plus everything beneath it, by `children` — the same ownership rule as above. */
function descendantIds(root: Unit, unitsById: Map<string, Unit>): Set<string> {
  const ids = new Set<string>();
  const stack = [root.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    stack.push(...(unitsById.get(id)?.children ?? []));
  }
  return ids;
}

const MODE_LABEL: Record<string, string> = {
  current: "Current",
  delta: "Delta",
  flows: "API Flow",
  depends: "Depends on",
};

export function App({ snapshotUrl }: AppProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revs, setRevs] = useState<RevSummary[]>([]);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [sha, setSha] = useState(() => shaFromSnapshotUrl(snapshotUrl));
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const renderSkin = useAppStore((s) => s.renderSkin);
  const view = useAppStore((s) => s.view);
  const setRenderSkin = useAppStore((s) => s.setRenderSkin);
  const selection = useAppStore((s) => s.selection);
  const focus = useAppStore((s) => s.focus);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const select = useAppStore((s) => s.select);
  const focusStack = useAppStore((s) => s.focusStack);
  const ascend = useAppStore((s) => s.ascend);
  const goTo = useAppStore((s) => s.goTo);
  const drill = useAppStore((s) => s.drill);

  useEffect(() => {
    document.documentElement.setAttribute("data-skin", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/snapshot/${sha}`)
      .then((res) => {
        if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
        return res.json() as Promise<Snapshot>;
      })
      .then((snapshot) => {
        if (!cancelled) setState({ status: "loaded", snapshot });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [sha]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/revs")
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : []))
      .then((list) => {
        if (!cancelled) setRevs(Array.isArray(list) ? (list as RevSummary[]) : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Delta mode's default "Against" preset is the selected rev's immediate parent
  // (docs/serve.md#4 "Delta" — "Previous", answers "what did this commit do").
  const revIndex = revs.findIndex((r) => r.sha === sha);
  const previousSha = revIndex >= 0 ? revs[revIndex + 1]?.sha : undefined;

  useEffect(() => {
    // Flows also needs delta data for its per-step status dot (docs/serve.md#4 "Flows" —
    // "in Delta mode, changed steps carry a status dot"); Current and Depends-on don't.
    if ((mode !== "delta" && mode !== "flows") || !previousSha) {
      setDelta(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/delta/${previousSha}/${sha}`)
      .then((res) => (res.ok ? (res.json() as Promise<Delta>) : null))
      .then((d) => {
        if (!cancelled) setDelta(d);
      })
      .catch(() => {
        if (!cancelled) setDelta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, previousSha, sha]);

  const snapshot = state.status === "loaded" ? state.snapshot : null;

  // Memoized so CanvasHost's props keep a stable identity across renders that don't
  // actually change the visible scene (e.g. selecting a tile) — otherwise every such
  // render hands CanvasHost new array/Map instances, which re-triggers its build effect
  // and replays each delta tile's pulse animation just from being selected.
  const { visibleUnits, visibleEdges, elidedEdges, deltaByUnit, boundaryEdges, externalUnits, siblings } = useMemo(() => {
    if (!snapshot)
      return {
        visibleUnits: [],
        visibleEdges: [],
        elidedEdges: 0,
        deltaByUnit: new Map<string, TileDeltaInfo>(),
        boundaryEdges: [] as BoundaryEdge[],
        externalUnits: [] as Unit[],
        siblings: [] as SiblingSummary[],
      };
    const { units, edges } = snapshot;

    // docs/serve.md#4 "Current": outermost is the system unit; a view shows only the
    // focused unit's direct children, never the whole graph flat. Collapse/expand mutates
    // the visible node set, not the graph (docs/serve.md#3).
    const unitsById = new Map(units.map((u) => [u.id, u]));
    const systemUnit = units.find((u) => u.kind === "system") ?? null;

    // The system's children are the group units the analyzer now emits, so the root view is
    // real units all the way down — the synthetic client-side domain tier this replaced could
    // not be drilled to, searched for, or diffed, because it had no unit behind it.
    const focusedUnit = (focus && unitsById.get(focus)) || systemUnit;
    // api_flow units are listed among the system unit's children (so Flows.tsx can find
    // them) but belong only in the dedicated Flows view, not the structural
    // Current/Delta/Depends-on tree.
    const visibleUnits = (
      focusedUnit ? units.filter((u) => focusedUnit.children.includes(u.id)) : units.filter((u) => u.parent === null)
    ).filter((u) => u.kind !== "api_flow");

    // Every tile can own descendants many levels deep — edges almost always connect those deep
    // leaves, not the tiles themselves — so each edge rolls up to whichever visible tile is its
    // nearest ancestor, and all the edges sharing a resulting pair merge into one connector
    // carrying their summed weight and the ids behind it. The budget then keeps the connectors
    // worth drawing (cross-boundary first) and reports the rest as elided rather than hiding
    // them silently.
    const { edges: visibleEdges, elided: elidedEdges } = applyEdgeBudget(
      rollUpEdges(edges, visibleUnits, unitsById),
      DEFAULT_EDGE_BUDGET,
      { unitsById },
    );

    // docs/serve.md#4 "Delta": a unit_delta is a direct hit; otherwise fall back to the
    // rollup so a collapsed ancestor still shows a hidden descendant's change ("a hot leaf
    // is visible as a hot ancestor before you drill").
    const unitDeltasById = new Map((delta?.unit_deltas ?? []).map((d) => [d.unit, d]));
    const deltaByUnit = new Map<string, TileDeltaInfo>(
      visibleUnits.flatMap((u): Array<[string, TileDeltaInfo]> => {
        const direct = unitDeltasById.get(u.id);
        if (direct) return [[u.id, { status: direct.status, amount: direct.amount, risk: direct.risk.score }]];
        const rolled = delta?.rollup[u.id];
        if (rolled) return [[u.id, { status: "rollup", amount: rolled.amount, risk: rolled.risk }]];
        return [];
      }),
    );
    // Edges with exactly one endpoint inside the focus were dropped by the loop above (their
    // outside endpoint has no visible tile). They come back as rows in the connected-siblings
    // tray, which is the only record the scene graph keeps of them.
    const { boundaryEdges, externalUnits } = focusedUnit
      ? collectBoundaryEdges({ focusedUnit, visibleUnits, edges, unitsById })
      : { boundaryEdges: [], externalUnits: [] };
    // Folded into this memo rather than a second one on purpose: an unstable prop identity
    // re-triggers CanvasHost's build effect and replays every delta tile's pulse animation, so
    // a mere tray hover must not produce a new array.
    const siblings = focusedUnit ? summariseSiblings({ focusedUnit, boundaryEdges, unitsById }) : [];

    return { visibleUnits, visibleEdges, elidedEdges, deltaByUnit, boundaryEdges, externalUnits, siblings };
  }, [snapshot, focus, delta]);

  if (state.status === "loading") return <div>Loading…</div>;
  if (state.status === "error") return <div>Could not load snapshot.</div>;

  const { units, edges, externals } = state.snapshot;
  const selectedUnit = units.find((u) => u.id === selection) ?? null;
  const selectedExternal = mode === "depends" ? (externals.find((x) => x.id === selection) ?? null) : null;
  const flowUnits = units.filter((u) => u.kind === "api_flow");
  const changedStepIds = delta ? new Set(delta.unit_deltas.map((d) => d.unit)) : undefined;
  // A function is a drillable zoom level like any other (store.ts) — Current/Delta render it
  // as a Flowchart instead of a tile grid, purely based on the focused unit's kind.
  const focusedUnit = focus ? (units.find((u) => u.id === focus) ?? null) : null;
  const flowchartFunction = (mode === "current" || mode === "delta") && focusedUnit?.kind === "function" ? focusedUnit : null;
  // Delta mode with an empty inspect queue means this revision has nothing to compare
  // against (e.g. the earliest rev) or nothing changed — either way there is no delta.
  const deltaIsEmpty = mode === "delta" && (delta?.inspect_queue ?? []).length === 0;

  // A searched-for unit is almost never on the level you are standing on, so selecting it
  // alone would highlight something off screen. Drilling to its parent puts it among the
  // visible tiles first; drill (rather than a bare focus set) is what keeps the breadcrumb
  // able to walk back the way you came.
  const revealUnit = (unitId: string) => {
    const parent = units.find((u) => u.id === unitId)?.parent;
    if (parent && parent !== focus) drill(parent);
    select(unitId);
  };

  return (
    <div className="app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar
        left={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <span style={{ font: "var(--weight-bold) var(--text-lg) var(--font-core)", color: "var(--text-hi)" }}>
              {state.snapshot.repo.root}
            </span>
            <span style={{ color: "var(--text-dim)", font: "var(--weight-regular) var(--text-sm) var(--font-core)" }}>
              {shortSha(sha)} · {MODE_LABEL[mode]} mode
            </span>
            <Breadcrumb focus={focus} focusStack={focusStack} units={units} onGoTo={goTo} onBack={ascend} />
          </div>
        }
        center={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            <SegmentedControl
              value={mode}
              onChange={(value) => setMode(value as "current" | "delta" | "depends" | "flows")}
              options={[
                { value: "current", label: "Current" },
                { value: "delta", label: "Delta" },
                { value: "flows", label: "API Flow" },
                { value: "depends", label: "Depends on" },
              ]}
            />
            <SegmentedControl
              value={theme}
              onChange={(value) => setTheme(value as "dark" | "light")}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
            <SegmentedControl
              value={renderSkin}
              onChange={(value) => setRenderSkin(value as RenderSkin)}
              options={[
                { value: "tiles", label: "2D" },
                { value: "tiles3d", label: "3D" },
                { value: "cityscape", label: "City" },
              ]}
            />
          </div>
        }
        right={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <UnitSearch units={units} onPick={revealUnit} />
            <Select
              data-testid="rev-picker"
              aria-label="revision"
              value={sha}
              onChange={(e) => setSha(e.target.value)}
              options={revs.map((r) => ({ value: r.sha, label: shortSha(r.sha) }))}
            />
          </div>
        }
      />
      <div className="body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {mode === "delta" && (
          <InspectQueue entries={delta?.inspect_queue ?? []} onSelect={(unitId) => select(unitId)} />
        )}
        {mode === "current" && (
          <div data-testid="legend-rail" style={{ flex: "none", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* The legend is a reading aid for an encoding that is on screen the whole time,
                so it has no useful collapsed state. It was the sole child of a collapsible
                "Layers" tray, where the gesture for hiding a layer list hid the legend too. */}
            <Tray title="Legend" dock="left" collapsible={false}>
              <Legend units={units} mode="current" />
              {renderSkin !== "tiles" && <ControlsHelp skin={renderSkin} view={view} />}
            </Tray>
          </div>
        )}
        {mode === "depends" && (
          <div data-testid="entry-points-rail" style={{ flex: "none", display: "flex", minHeight: 0 }}>
            {/* Depends-on lists external dependencies, not API entry routes — Flows.tsx
                uses the "entry points" label for the routes case. */}
            <Tray title="Dependencies" dock="left">
              <EntryPointsRail externals={externals} onSelect={(id) => select(id)} />
            </Tray>
          </div>
        )}
        {mode === "depends" ? (
          <DependsOn externals={externals} onSelect={(id) => select(id)} />
        ) : mode === "flows" ? (
          <Flows flows={flowUnits} units={units} edges={edges} onSelectStep={(id) => select(id)} changedStepIds={changedStepIds} />
        ) : flowchartFunction ? (
          <Flowchart functionUnit={flowchartFunction} units={units} edges={edges} />
        ) : deltaIsEmpty ? (
          // An ordinary graph rendered next to the tray's "no delta available" notice reads
          // as a contradiction; say it on the canvas, where the absent change would be.
          <div
            data-testid="delta-empty-canvas"
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--surface-0)",
              color: "var(--text-faint)",
              fontSize: 12,
            }}
          >
            Nothing changed in this revision — no delta to inspect.
          </div>
        ) : (
          renderSkin !== "tiles" ? (
            // Both 3D skins share one host: the contract makes which buildings get drawn and
            // how the camera moves the skin's business, so the host does not fork.
            <Suspense fallback={<div style={{ flex: 1, minWidth: 0 }} />}>
              <Canvas3dHost
                units={visibleUnits}
                edges={visibleEdges}
                deltaByUnit={mode === "delta" ? deltaByUnit : undefined}
                skin={renderSkin}
                elidedEdges={elidedEdges}
              />
            </Suspense>
          ) : (
            <CanvasHost
              units={visibleUnits}
              edges={visibleEdges}
              deltaByUnit={mode === "delta" ? deltaByUnit : undefined}
              boundaryEdges={boundaryEdges}
              externalUnits={externalUnits}
              siblings={siblings}
              focusId={focus}
              elidedEdges={elidedEdges}
            />
          )
        )}
        <Inspector
          unit={selectedUnit}
          units={units}
          edges={edges}
          external={selectedExternal}
          deltaQueue={mode === "delta" ? delta?.inspect_queue : undefined}
        />
      </div>
      {revs.length > 0 && <Replay revs={revs} sha={sha} onScrub={setSha} />}
    </div>
  );
}
