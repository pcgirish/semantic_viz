import { useEffect, useState } from "react";
import type { Snapshot } from "@scv/schema";
import { CanvasHost } from "./CanvasHost.js";

export type AppProps = {
  /** Full snapshot URL, e.g. /api/snapshot/:sha (implement-serve.md's API table). */
  snapshotUrl: string;
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "loaded"; snapshot: Snapshot };

export function App({ snapshotUrl }: AppProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

  return <CanvasHost units={state.snapshot.units} edges={state.snapshot.edges} />;
}
