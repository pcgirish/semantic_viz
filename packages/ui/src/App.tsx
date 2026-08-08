import { useEffect, useMemo, useState } from "react";
import type { Delta, Snapshot } from "@scv/schema";
import { PathBreadcrumb, SegmentedControl, Select, Toolbar, Tray } from "@scv/design-system";
import { Breadcrumb } from "./Breadcrumb.js";
import { CanvasHost, type TileDeltaInfo } from "./CanvasHost.js";
import { DependsOn } from "./DependsOn.js";
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

export function App({ snapshotUrl }: AppProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revs, setRevs] = useState<RevSummary[]>([]);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [sha, setSha] = useState(() => shaFromSnapshotUrl(snapshotUrl));
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
    const focusedUnit = (focus && unitsById.get(focus)) || systemUnit;
    // api_flow units are listed among the system unit's children (so Flows.tsx can find
    // them) but belong only in the dedicated Flows view, not the structural
    // Current/Delta/Depends-on tree.
    const visibleUnits = (
      focusedUnit ? units.filter((u) => focusedUnit.children.includes(u.id)) : units.filter((u) => u.parent === null)
    ).filter((u) => u.kind !== "api_flow");
    const visibleIds = new Set(visibleUnits.map((u) => u.id));
    const visibleEdges = edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));

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
        left={mode === "flowchart" ? undefined : <Breadcrumb focus={focus} focusStack={focusStack} units={units} onGoTo={goTo} onBack={ascend} />}
        center={
          <SegmentedControl
            value={mode === "flowchart" ? "current" : mode}
            onChange={(value) => setMode(value as "current" | "delta" | "depends" | "flows")}
            options={[
              { value: "current", label: "Current" },
              { value: "delta", label: "Delta" },
              { value: "depends", label: "Depends on" },
              { value: "flows", label: "Flows" },
            ]}
          />
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
        {(mode === "current" || mode === "depends") && (
          <div data-testid="legend-rail" style={{ flex: "none", display: "flex", minHeight: 0 }}>
            <Tray title="Layers" dock="left">
              <Legend units={units} mode={mode === "depends" ? "depends" : "current"} />
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
