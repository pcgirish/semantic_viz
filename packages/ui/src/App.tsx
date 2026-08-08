import { useEffect, useMemo, useState } from "react";
import type { Delta, Snapshot, Unit } from "@scv/schema";
import { PathBreadcrumb, SegmentedControl, Select, Toolbar, Tray } from "@scv/design-system";
import { Breadcrumb } from "./Breadcrumb.js";
import { CanvasHost, type TileDeltaInfo } from "./CanvasHost.js";
import { DependsOn } from "./DependsOn.js";
import { EntryPointsRail } from "./EntryPointsRail.js";
import { Flowchart } from "./Flowchart.js";
import { Flows } from "./Flows.js";
import { Inspector } from "./Inspector.js";
import { InspectQueue } from "./InspectQueue.js";
import { Legend } from "./Legend.js";
import { Replay, shortSha } from "./Replay.js";
import { useAppStore } from "./store.js";

export type AppProps = {
  /** Full snapshot URL, e.g. /api/snapshot/:sha (implement-serve.md's API table). */
  snapshotUrl: string;
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "loaded"; snapshot: Snapshot };

type RevSummary = { sha: string; kind: string; pr?: number; message?: string; ts: string; author: string; author_kind: string; amount: number };

function shaFromSnapshotUrl(url: string): string {
  return url.split("/").pop() ?? "";
}

const DOMAIN_PREFIX = "group:";

/** True for a synthetic domain pseudo-id (`group:<name>`) — has no matching real `Unit`. */
export function isDomainId(id: string): boolean {
  return id.startsWith(DOMAIN_PREFIX);
}

function domainId(group: string): string {
  return `${DOMAIN_PREFIX}${group}`;
}

/**
 * Synthetic client-side-only "domain" tier, grouping the system's layer-kind children by
 * their existing `group` field (mock parity — docs/mock/codedream-ui-mock.html shows 5
 * broad domains at the root, but the real analyzer's layer units are module-granularity;
 * `group` already carries the missing broader tier, driving the sidebar LAYERS panel, just
 * unused for canvas drill-level construction until now). No analyze/schema change: this
 * reads only fields already present in the .scv snapshot.
 */
function buildDomainUnits(systemUnit: Unit, unitsById: Map<string, Unit>): Unit[] {
  const layerChildren = systemUnit.children.map((id) => unitsById.get(id)).filter((u): u is Unit => !!u && u.kind === "layer");
  const byGroup = new Map<string, Unit[]>();
  for (const layer of layerChildren) {
    const group = layer.group ?? "ungrouped";
    const list = byGroup.get(group) ?? [];
    list.push(layer);
    byGroup.set(group, list);
  }
  return [...byGroup.entries()].map(([group, members]) => ({
    id: domainId(group),
    kind: "layer",
    name: `${group} · ${members.length}`,
    qualname: group,
    parent: systemUnit.id,
    children: members.map((m) => m.id),
    loc: { files: [], sloc: members.reduce((sum, m) => sum + m.loc.sloc, 0) },
    tags: [],
    metrics: {},
    hash: {},
    provenance: { source: "static" },
  }));
}

/**
 * Maps every unit to the domain tile its owning layer belongs to, walking each unit's
 * ancestor chain rather than only checking direct layer children — real edges connect
 * module/function-kind leaves nested under a layer, not the layer itself, so a shallow
 * children-only lookup misses nearly every edge (only matches the rare edge that happens
 * to run layer-to-layer directly).
 */
export function buildUnitToDomain(domainUnits: Unit[], unitsById: Map<string, Unit>): Map<string, string> {
  const layerToDomain = new Map(domainUnits.flatMap((d) => d.children.map((childId) => [childId, d.id])));
  const cache = new Map<string, string | undefined>();
  const resolve = (unitId: string): string | undefined => {
    if (cache.has(unitId)) return cache.get(unitId);
    cache.set(unitId, undefined); // break cycles defensively
    const direct = layerToDomain.get(unitId);
    const unit = unitsById.get(unitId);
    const result = direct ?? (unit?.parent ? resolve(unit.parent) : undefined);
    cache.set(unitId, result);
    return result;
  };
  const result = new Map<string, string>();
  for (const id of unitsById.keys()) {
    const domain = resolve(id);
    if (domain) result.set(id, domain);
  }
  return result;
}

const MODE_LABEL: Record<string, string> = {
  current: "Current",
  delta: "Delta",
  flows: "API Flow",
  flowchart: "Flowchart",
  depends: "Depends on",
};

export function App({ snapshotUrl }: AppProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revs, setRevs] = useState<RevSummary[]>([]);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [sha, setSha] = useState(() => shaFromSnapshotUrl(snapshotUrl));
  const [skin, setSkin] = useState<"dark" | "light">("dark");
  const selection = useAppStore((s) => s.selection);
  const focus = useAppStore((s) => s.focus);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const select = useAppStore((s) => s.select);
  const focusStack = useAppStore((s) => s.focusStack);
  const ascend = useAppStore((s) => s.ascend);
  const goTo = useAppStore((s) => s.goTo);
  const flowchartFunctionId = useAppStore((s) => s.flowchartFunctionId);

  useEffect(() => {
    document.documentElement.setAttribute("data-skin", skin);
  }, [skin]);

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
  const { visibleUnits, visibleEdges, deltaByUnit } = useMemo(() => {
    if (!snapshot) return { visibleUnits: [], visibleEdges: [], deltaByUnit: new Map<string, TileDeltaInfo>() };
    const { units, edges } = snapshot;

    // docs/serve.md#4 "Current": outermost is the system unit; a view shows only the
    // focused unit's direct children, never the whole graph flat. Collapse/expand mutates
    // the visible node set, not the graph (docs/serve.md#3).
    const unitsById = new Map(units.map((u) => [u.id, u]));
    const systemUnit = units.find((u) => u.kind === "system") ?? null;

    const rootDomainUnits = systemUnit ? buildDomainUnits(systemUnit, unitsById) : [];
    // Only worth a synthetic grouping level when it actually groups something; a single
    // domain (or none) collapses back to the plain flat list of the system's children.
    const useDomainTier = rootDomainUnits.length > 1;

    let visibleUnits: Unit[];
    let visibleEdges: typeof edges;
    if (focus === null && systemUnit && useDomainTier) {
      // System root: show the synthetic domain tier (mock parity) instead of the real,
      // module-granular layer units directly — same data, one grouped level inserted
      // client-side only (App.tsx docblock plan, items 1-3).
      const domainUnits = rootDomainUnits;
      visibleUnits = domainUnits;
      const unitToDomain = buildUnitToDomain(domainUnits, unitsById);
      const rolledEdgeIds = new Set<string>();
      visibleEdges = [];
      for (const e of edges) {
        const fromDomain = unitToDomain.get(e.from);
        const toDomain = unitToDomain.get(e.to);
        if (!fromDomain || !toDomain || fromDomain === toDomain) continue;
        const key = `${fromDomain}->${toDomain}`;
        if (rolledEdgeIds.has(key)) continue;
        rolledEdgeIds.add(key);
        visibleEdges.push({ ...e, id: key, from: fromDomain, to: toDomain, rollup: true });
      }
    } else {
      const focusIsDomain = useDomainTier && !!focus && isDomainId(focus);
      const focusedUnit = focusIsDomain ? null : (focus && unitsById.get(focus)) || systemUnit;
      const domainUnit = focusIsDomain ? (rootDomainUnits.find((d) => d.id === focus) ?? null) : null;
      // api_flow units are listed among the system unit's children (so Flows.tsx can find
      // them) but belong only in the dedicated Flows view, not the structural
      // Current/Delta/Depends-on tree.
      visibleUnits = (
        domainUnit
          ? units.filter((u) => domainUnit.children.includes(u.id))
          : focusedUnit
            ? units.filter((u) => focusedUnit.children.includes(u.id))
            : units.filter((u) => u.parent === null)
      ).filter((u) => u.kind !== "api_flow");
      const visibleIds = new Set(visibleUnits.map((u) => u.id));
      visibleEdges = edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
    }

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
    return { visibleUnits, visibleEdges, deltaByUnit };
  }, [snapshot, focus, delta]);

  if (state.status === "loading") return <div>Loading…</div>;
  if (state.status === "error") return <div>Could not load snapshot.</div>;

  const { units, edges, externals } = state.snapshot;
  const selectedUnit = units.find((u) => u.id === selection) ?? null;
  const selectedExternal = mode === "depends" ? (externals.find((x) => x.id === selection) ?? null) : null;
  const flowUnits = units.filter((u) => u.kind === "api_flow");
  const changedStepIds = delta ? new Set(delta.unit_deltas.map((d) => d.unit)) : undefined;
  const flowchartFunction = mode === "flowchart" ? (units.find((u) => u.id === flowchartFunctionId) ?? null) : null;
  const rootUnit = units.find((u) => u.kind === "system") ?? null;

  return (
    <div className="app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar
        left={
          mode === "flowchart" ? undefined : (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
              <span style={{ font: "var(--weight-bold) var(--text-lg) var(--font-core)", color: "var(--text-hi)" }}>orderly</span>
              <span style={{ color: "var(--text-dim)", font: "var(--weight-regular) var(--text-sm) var(--font-core)" }}>
                {shortSha(sha)} · {MODE_LABEL[mode]} mode
              </span>
              <Breadcrumb focus={focus} focusStack={focusStack} units={units} onGoTo={goTo} onBack={ascend} />
            </div>
          )
        }
        center={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            <SegmentedControl
              value={mode === "flowchart" ? "current" : mode}
              onChange={(value) => setMode(value as "current" | "delta" | "depends" | "flows")}
              options={[
                { value: "current", label: "Current" },
                { value: "delta", label: "Delta" },
                { value: "flows", label: "API Flow" },
                { value: "depends", label: "Depends on" },
              ]}
            />
            <SegmentedControl
              value={skin}
              onChange={(value) => setSkin(value as "dark" | "light")}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </div>
        }
        right={
          <Select
            data-testid="rev-picker"
            aria-label="revision"
            value={sha}
            onChange={(e) => setSha(e.target.value)}
            options={revs.map((r) => ({ value: r.sha, label: shortSha(r.sha) }))}
          />
        }
      />
      {mode === "flowchart" && flowchartFunction && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-6)",
            background: "var(--surface-0)",
            borderBottom: "var(--border-w) solid var(--border-hair)",
          }}
        >
          <PathBreadcrumb
            segments={[{ label: rootUnit?.name ?? "root" }, { label: "Call Graph" }, { label: flowchartFunction.name }]}
            onPick={(i) => {
              if (i === 0) ascend();
            }}
          />
        </div>
      )}
      <div className="body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {mode === "delta" && (
          <InspectQueue entries={delta?.inspect_queue ?? []} onSelect={(unitId) => select(unitId)} />
        )}
        {mode === "current" && (
          <div data-testid="legend-rail" style={{ flex: "none", display: "flex", minHeight: 0 }}>
            <Tray title="Layers" dock="left">
              <Legend units={units} mode="current" />
            </Tray>
          </div>
        )}
        {mode === "depends" && (
          <div data-testid="entry-points-rail" style={{ flex: "none", display: "flex", minHeight: 0 }}>
            <Tray title="Entry Points" dock="left">
              <EntryPointsRail externals={externals} onSelect={(id) => select(id)} />
            </Tray>
          </div>
        )}
        {mode === "depends" ? (
          <DependsOn externals={externals} onSelect={(id) => select(id)} />
        ) : mode === "flows" ? (
          <Flows flows={flowUnits} units={units} edges={edges} onSelectStep={(id) => select(id)} changedStepIds={changedStepIds} />
        ) : mode === "flowchart" && flowchartFunction ? (
          <Flowchart functionUnit={flowchartFunction} units={units} edges={edges} />
        ) : (
          <CanvasHost units={visibleUnits} edges={visibleEdges} deltaByUnit={mode === "delta" ? deltaByUnit : undefined} />
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
