import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "@scv/design-system/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// App-shell resets that don't belong in the shared design system: this app fills the
// viewport (html/body/#root at 100% height) and hides overflow at the body level since
// each view manages its own scrolling; buttons opt out of native chrome-provided font/color.
const shellStyle = document.createElement("style");
shellStyle.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  body { overflow: hidden; }
  button { font: inherit; color: inherit; }
`;
document.head.appendChild(shellStyle);

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
