import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Unit } from "@semviz/schema";
import { Legend } from "../src/Legend.js";

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "module",
    name: overrides.id,
    qualname: overrides.id,
    parent: null,
    children: [],
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

/** A group unit and its member layers, reciprocally linked — the shape the Legend walks. */
function groupWithLayers(groupId: string, name: string, layers: Array<{ id: string; name: string }>): Unit[] {
  return [
    makeUnit({ id: groupId, kind: "group", name, children: layers.map((l) => l.id) }),
    ...layers.map((l) => makeUnit({ id: l.id, kind: "layer", name: l.name, parent: groupId })),
  ];
}

describe("Legend", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains the connected-siblings tile fills, including the split for both-ways", () => {
    // The fill is the only thing on the canvas saying which way a tray sibling's edges run —
    // that sibling has no tile of its own — so it has to be decodable from the legend.
    const units = [
      makeUnit({ id: "u:layer:a", kind: "layer", name: "orders" }),
      makeUnit({ id: "x", parent: "u:layer:a" }),
    ];
    const { getByText, container } = render(<Legend units={units} mode="current" />);
    expect(getByText("Connected siblings")).toBeTruthy();
    expect(getByText("calls out to it")).toBeTruthy();
    expect(getByText("called into by it")).toBeTruthy();

    const split = getByText("both ways").querySelector("span") as HTMLElement;
    expect(split.style.background).toContain("var(--temp-4)");
    expect(split.style.background).toContain("var(--cool-azure)");
    expect(container.textContent).toContain("both ways");
  });

  it("renders one chip per distinct layer among the given units", () => {
    const units = [
      makeUnit({ id: "u:layer:a", kind: "layer", name: "orders" }),
      makeUnit({ id: "u:layer:b", kind: "layer", name: "infra" }),
      makeUnit({ id: "x", parent: "u:layer:a" }),
      makeUnit({ id: "y", parent: "u:layer:b" }),
      makeUnit({ id: "z", parent: "u:layer:a" }),
    ];
    const { container } = render(<Legend units={units} />);
    const chips = container.querySelectorAll(".chip");
    expect(chips).toHaveLength(2);
  });

  it("labels each chip with the layer unit's name", () => {
    const units = [makeUnit({ id: "u:layer:a", kind: "layer", name: "orders" }), makeUnit({ id: "x", parent: "u:layer:a" })];
    const { getByText } = render(<Legend units={units} />);
    expect(getByText("orders")).not.toBeNull();
  });

  it("renders nothing when there are no layer units", () => {
    const units = [makeUnit({ id: "x" })];
    const { container } = render(<Legend units={units} />);
    expect(container.querySelectorAll(".chip")).toHaveLength(0);
  });

  it("gives each chip a distinct background color", () => {
    const units = [
      makeUnit({ id: "u:layer:a", kind: "layer", name: "orders" }),
      makeUnit({ id: "u:layer:b", kind: "layer", name: "infra" }),
    ];
    const { container } = render(<Legend units={units} />);
    const chips = Array.from(container.querySelectorAll<HTMLElement>(".chip"));
    const colors = new Set(chips.map((c) => c.style.background));
    expect(colors.size).toBe(2);
  });

  it("renders one header row per group, with member layers nested underneath", () => {
    const units = [
      ...groupWithLayers("u:group:g1", "api surface", [
        { id: "u:layer:a", name: "orders" },
        { id: "u:layer:b", name: "billing" },
      ]),
      ...groupWithLayers("u:group:g2", "platform", [{ id: "u:layer:c", name: "queue" }]),
    ];
    const { getByText, getAllByText } = render(<Legend units={units} />);
    expect(getAllByText("api surface").length + getAllByText("platform").length).toBe(2);
    expect(getByText("api surface")).not.toBeNull();
    expect(getByText("platform")).not.toBeNull();
    expect(getByText("orders")).not.toBeNull();
    expect(getByText("billing")).not.toBeNull();
    expect(getByText("queue")).not.toBeNull();
  });

  it("keeps the group label inside the frame, so a tray that clips overflow cannot hide it", () => {
    const units = groupWithLayers("u:group:g1", "api surface", [{ id: "u:layer:a", name: "orders" }]);
    const { container } = render(<Legend units={units} />);

    // The design-system GroupFrame floats its label at top:-9px; inside a Tray with
    // overflow:hidden that label is clipped away. The Legend must reserve room for it.
    const frame = [...container.querySelectorAll<HTMLElement>("div")].find((d) =>
      d.style.border.includes("dashed"),
    );
    expect(frame).toBeDefined();
    expect(parseFloat(frame!.style.marginTop)).toBeGreaterThanOrEqual(9);
  });

  it("groups by the group unit's identity, so two groups sharing a name stay separate headers", () => {
    // Group names are LLM-authored and not unique; keying the legend on the name alone would
    // silently merge two distinct groups into one frame.
    const units = [
      ...groupWithLayers("u:group:g1", "platform", [{ id: "u:layer:a", name: "orders" }]),
      ...groupWithLayers("u:group:g2", "platform", [{ id: "u:layer:b", name: "billing" }]),
    ];
    const { getAllByText, getByText } = render(<Legend units={units} />);
    expect(getAllByText("platform")).toHaveLength(2);
    expect(getByText("orders")).not.toBeNull();
    expect(getByText("billing")).not.toBeNull();
  });

  it("falls a layer under no group unit into an 'other' header", () => {
    const units = [makeUnit({ id: "u:layer:a", kind: "layer", name: "orders" })];
    const { getByText } = render(<Legend units={units} />);
    expect(getByText("other")).not.toBeNull();
    expect(getByText("orders")).not.toBeNull();
  });

  it("still shows the existing per-layer chip color nested under its group header", () => {
    const units = groupWithLayers("u:group:g1", "api surface", [{ id: "u:layer:a", name: "orders" }]);
    const { container } = render(<Legend units={units} />);
    const chip = container.querySelector(".chip") as HTMLElement;
    expect(chip.style.background).toBeTruthy();
  });
});

describe("Legend at repository scale", () => {
  afterEach(cleanup);

  // A real repository clusters into 15+ top-level groups where the orderly fixture has 6
  // (docs/implement-serve.md:121-131). Rendering every one expanded turns the rail into a
  // scroll of chips, and the legend stops being readable at a glance — which is the only
  // thing it is for.
  function groups(n: number): Unit[] {
    return Array.from({ length: n }, (_, i) =>
      groupWithLayers(`u:group:${i}`, `group ${i}`, [{ id: `u:layer:${i}`, name: `layer ${i}` }]),
    ).flat();
  }

  it("shows every group expanded while there are few enough to read at once", () => {
    const { getByText } = render(<Legend units={groups(6)} />);
    for (let i = 0; i < 6; i++) expect(getByText(`layer ${i}`)).not.toBeNull();
  });

  it("collapses groups past the sixth, keeping their names but not their contents", () => {
    const { getByText, queryByText } = render(<Legend units={groups(12)} />);
    expect(getByText("layer 5")).not.toBeNull();
    // The 7th group's header is still a visible, clickable row — you can see it exists.
    expect(getByText("group 6")).not.toBeNull();
    expect(queryByText("layer 6")).toBeNull();
  });

  it("expands a collapsed group on demand, so nothing is unreachable", () => {
    const { getAllByRole, getByText, queryByText } = render(<Legend units={groups(12)} />);
    expect(queryByText("layer 6")).toBeNull();
    // Six groups render expanded; the buttons are the remainder, in order.
    fireEvent.click(getAllByRole("button", { name: /show 1 layer/i })[0]!);
    expect(getByText("layer 6")).not.toBeNull();
    // Expanding one does not expand the rest.
    expect(queryByText("layer 7")).toBeNull();
  });
});
