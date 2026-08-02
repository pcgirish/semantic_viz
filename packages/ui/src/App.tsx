import { useEffect, useState } from "react";
import type { Snapshot } from "@scv/schema";
import { CanvasHost } from "./CanvasHost.js";
import { Inspector } from "./Inspector.js";
import { useAppStore } from "./store.js";

export type AppProps = {
  /** Full snapshot URL, e.g. /api/snapshot/:sha (implement-serve.md's API table). */
  snapshotUrl: string;
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "loaded"; snapshot: Snapshot };

export function App({ snapshotUrl }: AppProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const selection = useAppStore((s) => s.selection);
  const focus = useAppStore((s) => s.focus);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(snapshotUrl)
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
  }, [snapshotUrl]);

  if (state.status === "loading") return <div>Loading…</div>;
  if (state.status === "error") return <div>Could not load snapshot.</div>;

  const { units, edges } = state.snapshot;
  const selectedUnit = units.find((u) => u.id === selection) ?? null;

  // docs/serve.md#4 "Current": outermost is the system unit; a view shows only the
  // focused unit's direct children, never the whole graph flat. Collapse/expand mutates
  // the visible node set, not the graph (docs/serve.md#3).
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const systemUnit = units.find((u) => u.kind === "system") ?? null;
  const focusedUnit = (focus && unitsById.get(focus)) || systemUnit;
  const visibleUnits = focusedUnit
    ? units.filter((u) => focusedUnit.children.includes(u.id))
    : units.filter((u) => u.parent === null);
  const visibleIds = new Set(visibleUnits.map((u) => u.id));
  const visibleEdges = edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));

  return (
    <div className="app">
      <CanvasHost units={visibleUnits} edges={visibleEdges} />
      <Inspector unit={selectedUnit} units={units} edges={edges} />
    </div>
  );
}
