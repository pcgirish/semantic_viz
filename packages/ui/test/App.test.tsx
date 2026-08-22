import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import type { Snapshot } from "@scv/schema";
import { App, buildUnitToAncestor } from "../src/App.js";
import { DEFAULT_EDGE_BUDGET } from "../src/edge-budget.js";
import { useAppStore } from "../src/store.js";

/** A real group unit: the tier that used to be synthesised client-side from a layer's `group` string. */
function makeGroup(id: string, name: string, children: string[]) {
  return {
    kind: "group",
    id,
    name,
    qualname: name,
    parent: "u:sys:orderly",
    children,
    loc: { files: [], sloc: 10 * children.length },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "llm" },
  };
}

function makeLayer(id: string, name: string, parent: string, children: string[]) {
  return {
    kind: "layer",
    id,
    name,
    qualname: name,
    parent,
    children,
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "llm" },
  };
}

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
        kind: "function",
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

function makeGroupedSnapshot(): Snapshot {
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
        children: ["u:group:api", "u:group:platform"],
        loc: { files: [], sloc: 30 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      makeGroup("u:group:api", "api surface", ["u:layer:api", "u:layer:auth"]),
      makeGroup("u:group:platform", "platform", ["u:layer:db"]),
      makeLayer("u:layer:api", "api_routes", "u:group:api", []),
      makeLayer("u:layer:auth", "auth", "u:group:api", []),
      makeLayer("u:layer:db", "database_connection", "u:group:platform", []),
    ],
    edges: [
      { id: "e1", from: "u:layer:api", to: "u:layer:db", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ],
    externals: [],
  } as unknown as Snapshot;
}

function makeGroupedSnapshotWithLeafEdges(): Snapshot {
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
        children: ["u:group:api", "u:group:platform"],
        loc: { files: [], sloc: 20 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      makeGroup("u:group:api", "api surface", ["u:layer:api"]),
      makeGroup("u:group:platform", "platform", ["u:layer:db"]),
      makeLayer("u:layer:api", "api_routes", "u:group:api", ["u:mod:api_handler"]),
      makeLayer("u:layer:db", "database_connection", "u:group:platform", ["u:mod:db_conn"]),
      // Real snapshots only carry edges between leaf module/function units nested under a
      // layer, never between the layer units themselves — this is what the group rollup
      // must walk up through, not just check direct layer children.
      {
        kind: "module",
        id: "u:mod:api_handler",
        name: "api_handler",
        qualname: "api_handler",
        parent: "u:layer:api",
        children: [],
        loc: { files: [], sloc: 5 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
      {
        kind: "module",
        id: "u:mod:db_conn",
        name: "db_conn",
        qualname: "db_conn",
        parent: "u:layer:db",
        children: [],
        loc: { files: [], sloc: 5 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
    ],
    edges: [
      {
        id: "e1",
        from: "u:mod:api_handler",
        to: "u:mod:db_conn",
        kind: "calls",
        weight: 1,
        source: "static",
        confidence: 1,
      },
    ],
    externals: [],
  } as unknown as Snapshot;
}

function makeUngroupedSnapshotWithDeepLeafEdges(): Snapshot {
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
        children: ["u:layer:api", "u:layer:db"],
        loc: { files: [], sloc: 20 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      // No group units — mirrors a snapshot whose layers were never grouped, so root falls
      // back to the plain layer list (`u.parent === null`).
      {
        kind: "layer",
        id: "u:layer:api",
        name: "api_routes",
        qualname: "api_routes",
        parent: null,
        children: ["u:mod:api"],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      {
        kind: "layer",
        id: "u:layer:db",
        name: "database_connection",
        qualname: "database_connection",
        parent: null,
        children: ["u:mod:db"],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      {
        kind: "module",
        id: "u:mod:api",
        name: "api",
        qualname: "api",
        parent: null,
        children: ["u:fn:api_handler"],
        loc: { files: [], sloc: 5 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
      {
        kind: "module",
        id: "u:mod:db",
        name: "db",
        qualname: "db",
        parent: null,
        children: ["u:fn:db_query"],
        loc: { files: [], sloc: 5 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
      // Two levels below the visible layer tiles — a function nested inside a module nested
      // inside a layer, linked to its parent via `.parent` (unlike the layer/module tier
      // above, which is only linked via the parent's `children` list, matching real .scv
      // snapshots where mid-tier containers leave their own `.parent` unset).
      {
        kind: "function",
        id: "u:fn:api_handler",
        name: "api_handler",
        qualname: "api.api_handler",
        parent: "u:mod:api",
        children: [],
        loc: { files: [], sloc: 3 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
      {
        kind: "function",
        id: "u:fn:db_query",
        name: "db_query",
        qualname: "db.db_query",
        parent: "u:mod:db",
        children: [],
        loc: { files: [], sloc: 3 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
    ],
    edges: [
      {
        id: "e1",
        from: "u:fn:api_handler",
        to: "u:fn:db_query",
        kind: "calls",
        weight: 1,
        source: "static",
        confidence: 1,
      },
    ],
    externals: [],
  } as unknown as Snapshot;
}

describe("buildUnitToAncestor", () => {
  it("maps a leaf unit nested under a layer to that layer's group, not just direct group children", () => {
    const groupUnits = [
      { id: "u:group:api", children: ["u:layer:api"] },
      { id: "u:group:platform", children: ["u:layer:db"] },
    ] as unknown as import("@scv/schema").Unit[];
    const unitsById = new Map([
      ["u:layer:api", { id: "u:layer:api", parent: "u:group:api" }],
      ["u:layer:db", { id: "u:layer:db", parent: "u:group:platform" }],
      ["u:mod:api_handler", { id: "u:mod:api_handler", parent: "u:layer:api" }],
      ["u:mod:db_conn", { id: "u:mod:db_conn", parent: "u:layer:db" }],
    ] as unknown as [string, import("@scv/schema").Unit][]);

    const result = buildUnitToAncestor(groupUnits, unitsById);

    expect(result.get("u:mod:api_handler")).toBe("u:group:api");
    expect(result.get("u:mod:db_conn")).toBe("u:group:platform");
  });
});

/**
 * A system whose two groups are densely coupled: enough distinct module pairs between them to
 * push the root view past `DEFAULT_EDGE_BUDGET`. The review's "test dense graphs" case — the
 * shape where connector density stops being a routing problem and becomes a policy one.
 */
function makeDenseSnapshot(modulesPerGroup: number): Snapshot {
  const left = Array.from({ length: modulesPerGroup }, (_, i) => `u:l${i}`);
  const right = Array.from({ length: modulesPerGroup }, (_, i) => `u:r${i}`);
  const module = (id: string, parent: string) => ({
    kind: "module", id, name: id, qualname: id, parent, children: [],
    loc: { files: [], sloc: 10 }, tags: [], metrics: {},
    hash: { struct: null, text: null, semantic: null }, provenance: { source: "static" },
  });
  const container = (kind: string, id: string, parent: string | null, children: string[]) => ({
    kind, id, name: id, qualname: id, parent, children,
    loc: { files: [], sloc: 10 * children.length }, tags: [], metrics: {},
    hash: { struct: null, text: null, semantic: null }, provenance: { source: "llm" },
  });

  // Every left module calls every right module, so the pairs vastly outnumber the budget even
  // after roll-up — and they all land on the same two group tiles.
  const edges = left.flatMap((from, i) =>
    right.map((to, j) => ({
      id: `e${i}-${j}`, from, to, kind: "calls", weight: 1, source: "static", confidence: 1,
    })),
  );

  return {
    schema: "scv/1",
    snapshot_id: "s1",
    repo: { root: "orderly", vcs: "git" },
    rev: { sha: "abc123", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a", author_kind: "human" },
    provenance: { extractor: "scv-ts/0.1.0" },
    units: [
      container("system", "u:sys:orderly", null, ["u:g:left", "u:g:right"]),
      container("group", "u:g:left", "u:sys:orderly", ["u:layer:left"]),
      container("group", "u:g:right", "u:sys:orderly", ["u:layer:right"]),
      container("layer", "u:layer:left", "u:g:left", left),
      container("layer", "u:layer:right", "u:g:right", right),
      ...left.map((id) => module(id, "u:layer:left")),
      ...right.map((id) => module(id, "u:layer:right")),
    ],
    edges,
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

  it("swaps the 2D canvas for the 3D host when the skin toggle is switched, keeping selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshot()) }),
    );

    render(<App snapshotUrl="/api/snapshot/latest" />);
    await waitFor(() => {
      expect(screen.getByTestId("canvas-svg")).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("canvas-svg").querySelector('.tile[data-id="u:a"]')!);
    expect(useAppStore.getState().selection).toBe("u:a");

    fireEvent.click(screen.getByRole("button", { name: "3D" }));

    // The contract is what makes this a host swap rather than a fork of the whole view.
    // Awaited because the 3D host is lazy — three.js is fetched only on the first switch.
    await waitFor(() => {
      expect(screen.getByTestId("canvas-3d")).not.toBeNull();
    });
    expect(screen.queryByTestId("canvas-svg")).toBeNull();
    expect(useAppStore.getState().selection).toBe("u:a");
  });

  it("offers all three skins and walks into the city, keeping selection across both switches", async () => {
    // The whole point of Wave 5: one Scene, three representations, and the same place in the
    // codebase throughout. Cityscape is a second 3D skin rather than a mode of the first, so
    // it must be reachable from the toolbar in its own right.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshot()) }),
    );

    render(<App snapshotUrl="/api/snapshot/latest" />);
    await waitFor(() => {
      expect(screen.getByTestId("canvas-svg")).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("canvas-svg").querySelector('.tile[data-id="u:a"]')!);
    fireEvent.click(screen.getByRole("button", { name: "City" }));

    await waitFor(() => {
      expect(screen.getByTestId("canvas-3d")).not.toBeNull();
    });
    // The minimap is what distinguishes the walkable skin: at eye level it is the only
    // instrument that can answer "which way is up the dependency graph?".
    expect(screen.getByTestId("minimap")).not.toBeNull();
    expect(useAppStore.getState().selection).toBe("u:a");

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    await waitFor(() => {
      expect(screen.queryByTestId("minimap")).toBeNull();
    });
    expect(screen.getByTestId("canvas-3d")).not.toBeNull();
    expect(useAppStore.getState().selection).toBe("u:a");
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

  it("shows the system's group units at the root, not its layer units flat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeGroupedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:group:api"]')).not.toBeNull();
    });

    // The 2 group units, not the 3 layer units beneath them.
    expect(container.querySelectorAll(".tile")).toHaveLength(2);
    expect(container.querySelector('.tile[data-id="u:group:platform"]')).not.toBeNull();
    expect(container.querySelector('.tile[data-id="u:layer:api"]')).toBeNull();
  });

  it("drilling into a group tile reveals its member layer units", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeGroupedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:group:api"]')).not.toBeNull();
    });

    fireEvent.doubleClick(container.querySelector('.tile[data-id="u:group:api"]')!);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:api"]')).not.toBeNull();
      expect(container.querySelector('.tile[data-id="u:layer:auth"]')).not.toBeNull();
    });
    // Two member layers, plus a boundary marker for the sibling group this group calls out to:
    // the fixture's api->db edge crosses the focus, and collapsing it onto the sibling is what
    // keeps cross-group coupling visible from inside a group.
    expect(container.querySelectorAll(".tile")).toHaveLength(3);
    expect(container.querySelector('.tile[data-id="u:group:platform"]')).not.toBeNull();

    fireEvent.doubleClick(screen.getByTestId("canvas-svg"));

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:group:api"]')).not.toBeNull();
    });
  });

  it("rolls up an edge between leaf units in different groups to a group-to-group edge, not just edges between layer units directly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeGroupedSnapshotWithLeafEdges()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:group:api"]')).not.toBeNull();
    });

    await waitFor(() => {
      const canvas = screen.getByTestId("canvas-svg");
      expect(canvas.querySelectorAll("svg > g > path")).not.toHaveLength(0);
    });
  });

  it("rolls up an edge between deeply nested functions to a connector between their root layer tiles when the layers are in no group", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeUngroupedSnapshotWithDeepLeafEdges()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:api"]')).not.toBeNull();
      expect(container.querySelector('.tile[data-id="u:layer:db"]')).not.toBeNull();
    });

    await waitFor(() => {
      const canvas = screen.getByTestId("canvas-svg");
      expect(canvas.querySelectorAll("svg > g > path")).not.toHaveLength(0);
    });
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

  it("shows a flowchart-crumb path (drilled units › function) reflecting the real drill path, and clicking an earlier segment exits back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    // Drill into u:layer:ops first, then into the function u:a, mirroring a real navigation
    // path, so the breadcrumb has a real earlier focusStack segment to click back to.
    useAppStore.getState().drill("u:layer:ops");
    useAppStore.getState().drill("u:a");

    let nav!: HTMLElement;
    await waitFor(() => {
      nav = container.querySelector("nav")!;
      expect(nav).not.toBeNull();
      expect(nav.textContent).toContain("ops");
      expect(nav.textContent).toContain("a");
    });

    fireEvent.click(within(nav).getByText("ops"));

    await waitFor(() => {
      expect(useAppStore.getState().focus).toBe("u:layer:ops");
      expect(useAppStore.getState().focusStack).toEqual([]);
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });
  });

  it("shows a Back button when focused on a function that exits back to the previous focus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(screen.getByTestId("legend-rail")).not.toBeNull();
    });

    useAppStore.getState().drill("u:a");

    await waitFor(() => {
      expect(screen.getByText("orderly")).toBeInTheDocument();
      expect(screen.getByText("‹ Back")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("‹ Back"));

    await waitFor(() => {
      expect(useAppStore.getState().focus).toBeNull();
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });
  });

  it("keeps the Layers rail visible when drilling into a function from Current", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(screen.getByTestId("legend-rail")).not.toBeNull();
    });

    useAppStore.getState().drill("u:a");

    await waitFor(() => {
      expect(screen.getByText("orderly")).toBeInTheDocument();
      expect(screen.getByTestId("legend-rail")).not.toBeNull();
    });
  });

  it("keeps the legend readable when its tray header is clicked", async () => {
    // The legend is a reading aid, not a panel: the encoding it explains is on screen the
    // whole time, so there is no state in which hiding it helps. It used to be the sole
    // child of a collapsible "Layers" tray, where the collapse gesture meant to hide a layer
    // list took the legend with it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);

    const rail = await screen.findByTestId("legend-rail");
    const header = rail.querySelector("header")!;
    const legendText = () => within(rail).queryByText(/complexity/i);
    expect(legendText()).not.toBeNull();

    fireEvent.click(header);

    await waitFor(() => {
      expect(legendText()).not.toBeNull();
    });
  });

  it("puts the controls help in the same rail as the legend, only for a 3D skin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);

    const rail = await screen.findByTestId("legend-rail");
    // The 2D grid has no camera to explain.
    expect(within(rail).queryByTestId("controls-help")).toBeNull();

    useAppStore.getState().setRenderSkin("cityscape");

    await waitFor(() => {
      expect(within(rail).getByTestId("controls-help")).toBeInTheDocument();
    });
  });

  it("rewrites the controls help when the camera switches, from outside the canvas", async () => {
    // The pin for lifting view state out of Canvas3dHost: the rail is its sibling, so this
    // text can only track the camera if the mode lives in the store.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);
    const rail = await screen.findByTestId("legend-rail");
    useAppStore.getState().setRenderSkin("cityscape");

    await waitFor(() => {
      expect(within(rail).getByText(/fly across the city/i)).toBeInTheDocument();
    });

    useAppStore.getState().setView("street");

    await waitFor(() => {
      expect(within(rail).getByText(/release the pointer/i)).toBeInTheDocument();
      expect(within(rail).queryByText(/fly across the city/i)).toBeNull();
    });
  });

  it("focuses a unit picked from search, bypassing the drill hierarchy", async () => {
    // On a repository deep enough to have a hierarchy, walking it is the slow way to reach a
    // known file — you must first know which top-level group owns it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);

    const box = await screen.findByRole("searchbox");
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.click(screen.getAllByRole("option")[0]!);

    await waitFor(() => {
      expect(useAppStore.getState().selection).not.toBeNull();
    });
  });

  it("shows a rev picker populated from /api/revs, newest first", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "a" },
              { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a" },
            ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(screen.getByTestId("rev-picker")).toBeInTheDocument();
    });

    const options = screen.getByTestId("rev-picker").querySelectorAll("option");
    expect([...options].map((o) => o.textContent)).toEqual(["bbb", "aaa"]);
  });

  it("switching VIEW to Delta fetches the delta against the previous rev and renders the inspect queue", async () => {
    const delta = {
      schema: "scv-delta/1",
      from: { snapshot_id: "s0", sha: "aaa" },
      to: { snapshot_id: "s1", sha: "bbb" },
      provenance: { extractor: "scv-ts/0.1.0", formulas: {} },
      inspect_queue: [{ rank: 1, unit: "u:a", qualname: "a", status: "modified", risk: 0.6, confidence: 0.8 }],
      unit_deltas: [
        {
          unit: "u:a",
          qualname: "a",
          kind: "module",
          status: "modified",
          fields: ["semantics"],
          amount: 0.4,
          blast_radius: { direct: 0, transitive: 0, public_api: false },
          authors: [],
          risk: { score: 0.6, axes: null, why: null, confidence: 0.8, source: "formula" },
        },
      ],
      edge_deltas: [],
      rollup: {},
    };
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "a" },
              { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a" },
            ]),
        });
      }
      if (url === "/api/delta/aaa/bbb") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(delta) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App snapshotUrl="/api/snapshot/bbb" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/delta/aaa/bbb");
    });

    await waitFor(() => {
      expect(screen.getByTestId("inspect-queue")).toBeInTheDocument();
      expect(screen.getByTestId("inspect-queue")).toHaveTextContent("a");
    });

    expect((container.querySelector('.tile[data-id="u:a"]') as HTMLElement).style.background).not.toBe("");
  });

  it("selecting a tile in Delta mode doesn't recreate tile elements", async () => {
    const delta = {
      schema: "scv-delta/1",
      from: { snapshot_id: "s0", sha: "aaa" },
      to: { snapshot_id: "s1", sha: "bbb" },
      provenance: { extractor: "scv-ts/0.1.0", formulas: {} },
      inspect_queue: [{ rank: 1, unit: "u:a", qualname: "a", status: "modified", risk: 0.6, confidence: 0.8 }],
      unit_deltas: [
        {
          unit: "u:a",
          qualname: "a",
          kind: "module",
          status: "modified",
          fields: ["semantics"],
          amount: 0.4,
          blast_radius: { direct: 0, transitive: 0, public_api: false },
          authors: [],
          risk: { score: 0.6, axes: null, why: null, confidence: 0.8, source: "formula" },
        },
      ],
      edge_deltas: [],
      rollup: {},
    };
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "a" },
              { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a" },
            ]),
        });
      }
      if (url === "/api/delta/aaa/bbb") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(delta) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App snapshotUrl="/api/snapshot/bbb" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    await waitFor(() => {
      expect((container.querySelector('.tile[data-id="u:a"]') as HTMLElement).style.background).not.toBe("");
    });

    const tileBefore = container.querySelector('.tile[data-id="u:a"]')!;
    fireEvent.click(tileBefore);
    const tileAfter = container.querySelector('.tile[data-id="u:a"]')!;

    expect(tileAfter).toBe(tileBefore);
  });

  it("colors a collapsed ancestor via rollup when the changed unit is a hidden descendant, not itself in unit_deltas", async () => {
    // u:layer:ops is the only visible tile (system's direct child); the actual change is on
    // u:a, a grandchild hidden below the current focus depth. docs/serve.md#4 "Delta":
    // "Collapsed parents inherit the rollup, so a hot leaf is visible as a hot ancestor
    // before you drill."
    const delta = {
      schema: "scv-delta/1",
      from: { snapshot_id: "s0", sha: "aaa" },
      to: { snapshot_id: "s1", sha: "bbb" },
      provenance: { extractor: "scv-ts/0.1.0", formulas: {} },
      inspect_queue: [{ rank: 1, unit: "u:a", qualname: "a", status: "modified", risk: 0.9, confidence: 0.8 }],
      unit_deltas: [
        {
          unit: "u:a",
          qualname: "a",
          kind: "module",
          status: "modified",
          fields: ["semantics"],
          amount: 0.4,
          blast_radius: { direct: 0, transitive: 0, public_api: false },
          authors: [],
          risk: { score: 0.9, axes: null, why: null, confidence: 0.8, source: "formula" },
        },
      ],
      edge_deltas: [],
      rollup: { "u:layer:ops": { amount: 0.4, risk: 0.9, sloc: 10 } },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "a" },
              { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a" },
            ]),
        });
      }
      if (url === "/api/delta/aaa/bbb") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(delta) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App snapshotUrl="/api/snapshot/bbb" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    await waitFor(() => {
      const tile = container.querySelector('.tile[data-id="u:layer:ops"]') as HTMLElement;
      expect(tile.style.background).not.toBe("");
      expect(tile.style.filter).toContain("drop-shadow");
    });
  });

  it("shows the Replay timeline and scrubbing a bar changes the selected rev", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { sha: "bbb", kind: "pr", ts: "2026-01-02T00:00:00Z", author: "a", author_kind: "human", amount: 0.5 },
              { sha: "aaa", kind: "pr", ts: "2026-01-01T00:00:00Z", author: "a", author_kind: "human", amount: 0 },
            ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App snapshotUrl="/api/snapshot/bbb" />);

    const replayBar = () => screen.getAllByRole("button").filter((b) => b.title.includes(" · amount "));

    await waitFor(() => {
      expect(replayBar()).toHaveLength(2);
    });

    fireEvent.click(replayBar()[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("rev-picker")).toHaveValue("aaa");
    });
  });

  it("renders the inspect queue in the left margin, before the canvas", async () => {
    const delta = {
      schema: "scv-delta/1",
      from: { snapshot_id: "s0", sha: "aaa" },
      to: { snapshot_id: "s1", sha: "bbb" },
      provenance: { extractor: "scv-ts/0.1.0", formulas: {} },
      inspect_queue: [{ rank: 1, unit: "u:a", qualname: "a", status: "modified", risk: 0.6, confidence: 0.8 }],
      unit_deltas: [],
      edge_deltas: [],
      rollup: {},
    };
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "a", author_kind: "human", amount: 0.5 },
              { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a", author_kind: "human", amount: 0 },
            ]),
        });
      }
      if (url === "/api/delta/aaa/bbb") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(delta) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App snapshotUrl="/api/snapshot/bbb" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    await waitFor(() => {
      expect(screen.getByTestId("inspect-queue")).toBeInTheDocument();
    });

    const bodyChildren = Array.from(container.querySelector(".body")!.children);
    const queueIndex = bodyChildren.findIndex((el) => el.getAttribute("data-testid") === "inspect-queue");
    const canvasIndex = bodyChildren.findIndex((el) => el.classList.contains("canvas-scroll"));
    expect(queueIndex).toBeGreaterThanOrEqual(0);
    expect(queueIndex).toBeLessThan(canvasIndex);
  });

  function makeSnapshotWithExternals(): Snapshot {
    return {
      ...makeSnapshot(),
      externals: [
        {
          id: "x:pypi:redis@5.0.1",
          ecosystem: "pypi",
          name: "redis",
          version: "5.0.1",
          direct: true,
          depth: 1,
          reached_by: ["u:a"],
          transitive_count: null,
        },
      ],
    } as unknown as Snapshot;
  }

  it("renders the legend as a fixed left rail in Current mode, before the canvas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(screen.getByTestId("legend-rail")).not.toBeNull();
    });

    const bodyChildren = Array.from(container.querySelector(".body")!.children);
    const railIndex = bodyChildren.findIndex((el) => el.getAttribute("data-testid") === "legend-rail");
    const canvasIndex = bodyChildren.findIndex((el) => el.classList.contains("canvas-scroll"));
    expect(railIndex).toBeGreaterThanOrEqual(0);
    expect(railIndex).toBeLessThan(canvasIndex);
  });

  it("renders the entry-points rail (not the layers legend) in Depends-on mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /depends on/i }));

    await waitFor(() => {
      expect(screen.getByTestId("entry-points-rail")).not.toBeNull();
    });
    expect(screen.queryByTestId("legend-rail")).toBeNull();
  });

  it("titles the Depends-on rail for external dependencies, not API entry points", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);
    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /depends on/i }));

    const rail = await screen.findByTestId("entry-points-rail");
    expect(rail.textContent).toMatch(/dependencies/i);
    expect(rail.textContent).not.toMatch(/entry points/i);
  });

  it("shows the inspect queue rail in Delta mode even when no delta exists yet (e.g. earliest rev)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a" }]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App snapshotUrl="/api/snapshot/aaa" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    await waitFor(() => {
      expect(screen.getByTestId("inspect-queue")).toBeInTheDocument();
      expect(screen.getByTestId("inspect-queue")).toHaveTextContent(/no delta available/i);
    });
  });

  it("marks the canvas itself as having no delta, instead of rendering an ordinary graph beside a 'no delta' notice", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/revs") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a" }]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSnapshot()) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App snapshotUrl="/api/snapshot/aaa" />);
    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /delta/i }));

    const empty = await screen.findByTestId("delta-empty-canvas");
    expect(empty.textContent).toMatch(/nothing changed|no delta/i);
  });

  it("keeps the ordinary delta canvas when the revision does have changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshot()) }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);
    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    expect(screen.queryByTestId("delta-empty-canvas")).toBeNull();
  });

  it("switching VIEW to Depends on shows externals instead of the canvas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshotWithExternals()) }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /depends on/i }));

    await waitFor(() => {
      expect(container.querySelector(".dep-row")).not.toBeNull();
    });
    expect(container.querySelector(".canvas-scroll")).toBeNull();
  });

  it("clicking an external in Depends-on mode shows it in the inspector tray", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshotWithExternals()) }),
    );

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /depends on/i }));

    await waitFor(() => {
      expect(container.querySelector(".dep-row svg g")).not.toBeNull();
    });

    fireEvent.click(container.querySelector(".dep-row svg g")!);

    await waitFor(() => {
      expect(screen.getAllByText(/redis/i).length).toBeGreaterThan(0);
    });
  });

  function makeSnapshotWithFlow(): Snapshot {
    return {
      ...makeSnapshot(),
      units: [
        ...makeSnapshot().units,
        {
          kind: "api_flow",
          id: "u:flow:1",
          name: "GET /orders/{id}",
          qualname: "GET /orders/{id}",
          route: "GET /orders/{id}",
          steps: ["u:a"],
          parent: null,
          children: [],
          loc: { files: [], sloc: 0 },
          tags: [],
          metrics: { hops: 1 },
          hash: { struct: null, text: null, semantic: null },
          provenance: { source: "llm" },
        },
      ],
    } as unknown as Snapshot;
  }

  it("does not render an api_flow unit as a tile in the Current view", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshotWithFlow()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });
    expect(container.querySelector('.tile[data-id="u:flow:1"]')).toBeNull();
  });

  it("switching VIEW to Flows shows entry points instead of the canvas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshotWithFlow()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /^api flow$/i }));

    await waitFor(() => {
      expect(screen.getAllByText("GET /orders/{id}").length).toBeGreaterThan(0);
    });
    expect(container.querySelector(".canvas-scroll")).toBeNull();
  });

  it("clicking a step in Flows mode shows that unit in the inspector tray", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeSnapshotWithFlow()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:a"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /^api flow$/i }));

    await waitFor(() => {
      expect(container.querySelector(".flow-step")).not.toBeNull();
    });

    fireEvent.click(container.querySelector(".flow-step")!);

    await waitFor(() => {
      expect(screen.getByText("u:a")).toBeInTheDocument();
    });
  });
  it("collapses a dense cross-group graph onto one connector carrying every contributor", async () => {
    // 400 concrete leaf edges, all between the same two groups. At root focus they are one
    // relationship, and the view must say so with the real count rather than draw 400 lines or
    // report the first edge's weight of 1.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeDenseSnapshot(20)) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:g:left"]')).not.toBeNull();
    });

    // Two group tiles, one relationship between them — not one connector per leaf pair.
    const connectors = container.querySelectorAll(".connector, path.link, line.link");
    expect(connectors.length).toBeLessThan(20);
    // Nothing was dropped: 400 edges roll up to a single connector, well inside the budget.
    expect(screen.queryByTestId("edges-elided")).toBeNull();
  });

  it("says how many connectors the budget elided instead of hiding them silently", async () => {
    // Distinct visible tiles, each pair its own connector, so roll-up cannot rescue the count
    // and the budget has to bite. A view showing a subset must admit it.
    const snapshot = makeDenseSnapshot(2);
    const many = Array.from({ length: DEFAULT_EDGE_BUDGET + 5 }, (_, i) => ({
      kind: "module", id: `u:x${i}`, name: `x${i}`, qualname: `x${i}`, parent: "u:sys:orderly",
      children: [], loc: { files: [], sloc: 10 }, tags: [], metrics: {},
      hash: { struct: null, text: null, semantic: null }, provenance: { source: "static" },
    }));
    const system = snapshot.units.find((u) => u.kind === "system")!;
    system.children = [...system.children, ...many.map((m) => m.id)];
    snapshot.units = [...snapshot.units, ...(many as unknown as Snapshot["units"])];
    // A chain x0->x1->x2... : every edge joins two distinct visible tiles, so each is its own
    // connector and the total exceeds the budget.
    snapshot.edges = many.slice(0, -1).map((m, i) => ({
      id: `chain${i}`, from: m.id, to: many[i + 1]!.id, kind: "calls", weight: 1,
      source: "static", confidence: 1,
    })) as unknown as Snapshot["edges"];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(snapshot) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(screen.getByTestId("edges-elided")).toHaveTextContent(/4 connectors hidden/i);
    });
  });

  it("carries the elided count into the 3D host too, which drops the same connectors", async () => {
    // The budget runs once, before the host is chosen, so 3D shows exactly the subset 2D does.
    // Reporting it in only one host makes the other quietly incomplete.
    const snapshot = makeDenseSnapshot(2);
    const many = Array.from({ length: DEFAULT_EDGE_BUDGET + 5 }, (_, i) => ({
      kind: "module", id: `u:x${i}`, name: `x${i}`, qualname: `x${i}`, parent: "u:sys:orderly",
      children: [], loc: { files: [], sloc: 10 }, tags: [], metrics: {},
      hash: { struct: null, text: null, semantic: null }, provenance: { source: "static" },
    }));
    const system = snapshot.units.find((u) => u.kind === "system")!;
    system.children = [...system.children, ...many.map((m) => m.id)];
    snapshot.units = [...snapshot.units, ...(many as unknown as Snapshot["units"])];
    snapshot.edges = many.slice(0, -1).map((m, i) => ({
      id: `chain${i}`, from: m.id, to: many[i + 1]!.id, kind: "calls", weight: 1,
      source: "static", confidence: 1,
    })) as unknown as Snapshot["edges"];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(snapshot) }));

    render(<App snapshotUrl="/api/snapshot/latest" />);
    await waitFor(() => {
      expect(screen.getByTestId("edges-elided")).toHaveTextContent(/4 connectors hidden/i);
    });

    fireEvent.click(screen.getByRole("button", { name: "3D" }));

    await waitFor(() => {
      expect(screen.getByTestId("edges-elided-3d")).toHaveTextContent(/4 connectors hidden/i);
    });
  });
});
