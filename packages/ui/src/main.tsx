import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "@scv/design-system/styles.css";
import "./app.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// GET /api/revs returns the timeline newest-first (SnapshotStore.listRevs), so the
// first entry is the latest snapshot to open by default.
async function boot(): Promise<void> {
  const res = await fetch("/api/revs");
  const revs = (await res.json()) as Array<{ sha: string }>;
  const sha = revs[0]?.sha;
  if (!sha) throw new Error("no revisions available");
  createRoot(root!).render(<App snapshotUrl={`/api/snapshot/${sha}`} />);
}

void boot();
