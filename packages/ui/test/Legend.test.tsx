import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Unit } from "@scv/schema";
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

describe("Legend", () => {
  afterEach(() => {
    cleanup();
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
      makeUnit({ id: "u:layer:a", kind: "layer", name: "orders", group: "api surface" }),
      makeUnit({ id: "u:layer:b", kind: "layer", name: "billing", group: "api surface" }),
      makeUnit({ id: "u:layer:c", kind: "layer", name: "queue", group: "platform" }),
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
    const units = [makeUnit({ id: "u:layer:a", kind: "layer", name: "orders", group: "api surface" })];
    const { container } = render(<Legend units={units} />);

    // The design-system GroupFrame floats its label at top:-9px; inside a Tray with
    // overflow:hidden that label is clipped away. The Legend must reserve room for it.
    const frame = [...container.querySelectorAll<HTMLElement>("div")].find((d) =>
      d.style.border.includes("dashed"),
    );
    expect(frame).toBeDefined();
    expect(parseFloat(frame!.style.marginTop)).toBeGreaterThanOrEqual(9);
  });

  it("falls a layer with no group under an 'other' header", () => {
    const units = [makeUnit({ id: "u:layer:a", kind: "layer", name: "orders" })];
    const { getByText } = render(<Legend units={units} />);
    expect(getByText("other")).not.toBeNull();
    expect(getByText("orders")).not.toBeNull();
  });

  it("still shows the existing per-layer chip color nested under its group header", () => {
    const units = [makeUnit({ id: "u:layer:a", kind: "layer", name: "orders", group: "api surface" })];
    const { container } = render(<Legend units={units} />);
    const chip = container.querySelector(".chip") as HTMLElement;
    expect(chip.style.background).toBeTruthy();
  });
});
