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
        children: ["u:layer:api", "u:layer:auth", "u:layer:db"],
        loc: { files: [], sloc: 30 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
      },
      {
        kind: "layer",
        id: "u:layer:api",
        name: "api_routes",
        qualname: "api_routes",
        parent: "u:sys:orderly",
        children: [],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
        group: "api surface",
      },
      {
        kind: "layer",
        id: "u:layer:auth",
        name: "auth",
        qualname: "auth",
        parent: "u:sys:orderly",
        children: [],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
        group: "api surface",
      },
      {
        kind: "layer",
        id: "u:layer:db",
        name: "database_connection",
        qualname: "database_connection",
        parent: "u:sys:orderly",
        children: [],
        loc: { files: [], sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "llm" },
        group: "platform",
      },
    ],
    edges: [
      { id: "e1", from: "u:layer:api", to: "u:layer:db", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ],
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

  it("groups the system's layer children by their group field into a synthetic domain tier at the root", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeGroupedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="group:api surface"]')).not.toBeNull();
    });

    // 2 domains ("api surface", "platform"), not the 3 real layer units flat.
    expect(container.querySelectorAll(".tile")).toHaveLength(2);
    expect(container.querySelector('.tile[data-id="group:platform"]')).not.toBeNull();
    expect(container.querySelector('.tile[data-id="u:layer:api"]')).toBeNull();
  });

  it("drilling into a synthetic domain tile reveals its real member layer units", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeGroupedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="group:api surface"]')).not.toBeNull();
    });

    fireEvent.doubleClick(container.querySelector('.tile[data-id="group:api surface"]')!);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:api"]')).not.toBeNull();
      expect(container.querySelector('.tile[data-id="u:layer:auth"]')).not.toBeNull();
    });
    expect(container.querySelectorAll(".tile")).toHaveLength(2);

    fireEvent.doubleClick(screen.getByTestId("canvas-svg"));

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="group:api surface"]')).not.toBeNull();
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

  it("shows a flowchart-crumb path (root › Call Graph › function) in Flowchart mode, and clicking root exits back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNestedSnapshot()) }));

    const { container } = render(<App snapshotUrl="/api/snapshot/latest" />);

    await waitFor(() => {
      expect(container.querySelector('.tile[data-id="u:layer:ops"]')).not.toBeNull();
    });

    useAppStore.getState().showFlowchart("u:a");

    await waitFor(() => {
      expect(screen.getByText("orderly")).toBeInTheDocument();
      expect(screen.getByText("Call Graph")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("orderly"));

    await waitFor(() => {
      expect(useAppStore.getState().mode).toBe("current");
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
});
