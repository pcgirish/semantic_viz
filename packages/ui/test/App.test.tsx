import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { Snapshot } from "@scv/schema";
import { App } from "../src/App.js";
import { useAppStore } from "../src/store.js";

function makeSnapshot(): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: "s1",
    repo: { root: "orderly", vcs: "git" },
    rev: { sha: "abc123", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a", author_kind: "human" },
    provenance: { extractor: "scv-ts/0.1.0" },
    units: [
      {
        kind: "module",
        id: "u:a",
        name: "a",
        qualname: "a",
        parent: null,
        children: [],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
    ],
    edges: [],
    externals: [],
  } as unknown as Snapshot;
}

function makeNestedSnapshot(): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: "s1",
    repo: { root: "orderly", vcs: "git" },
    rev: { sha: "abc123", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a", author_kind: "human" },
    provenance: { extractor: "scv-ts/0.1.0" },
    units: [
      {
        kind: "system",
        id: "u:sys:orderly",
        name: "orderly",
        qualname: "orderly",
        parent: null,
        children: ["u:layer:ops"],
        loc: { files: [], sloc: 20 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      {
        kind: "layer",
        id: "u:layer:ops",
        name: "ops",
        qualname: "ops",
        parent: "u:sys:orderly",
        children: ["u:a"],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      {
        kind: "module",
        id: "u:a",
        name: "a",
        qualname: "a",
        parent: "u:layer:ops",
        children: [],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
    ],
    edges: [],
    externals: [],
  } as unknown as Snapshot;
}

describe("App", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches the latest snapshot and renders its units as tiles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeSnapshot()),
      }),
    );

    render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(document.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });
  });

  it("shows an error state when the fetch fails, not a silent blank canvas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    render(<App snapshotUrl="/api/snapshot/missing" />);

    await waitFor(() => {
      expect(screen.getByText(/could not load/i)).toBeInTheDocument();
    });
  });

  it("clicking a tile shows that unit in the inspector tray", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeSnapshot()),
      }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    expect(screen.getByText(/nothing selected/i)).toBeInTheDocument();

    fireEvent.click(container.querySelector('.tile[data-id="u:a"]')!);

    await waitFor(() => {
      expect(screen.queryByText(/nothing selected/i)).toBeNull();
    });
  });

  it("shows only the system unit's direct children by default, not every unit in the snapshot flat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeNestedSnapshot()),
      }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    expect(container.querySelectorAll(".tile")).toHaveLength(1);
    expect(container.querySelector('.tile[data-id="u:a"]')).toBeNull();
    expect(container.querySelector('.tile[data-id="u:sys:orderly"]')).toBeNull();
  });

  it("drilling into a tile shows its children; double-click on empty canvas ascends back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeNestedSnapshot()),
      }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    fireEvent.doubleClick(container.querySelector('.tile[data-id="u:layer:ops"]')!);

    await waitFor(() => {
      expect(container.querySelectorAll(".tile")).toHaveLength(1);
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.doubleClick(screen.getByTestId("canvas-svg"));

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
      expect(container.querySelectorAll(".tile")).toHaveLength(1);
    });
  });
});
