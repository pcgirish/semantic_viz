import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Unit } from "@scv/schema";
import { Flows } from "../src/Flows.js";

afterEach(cleanup);

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "function",
    name: overrides.id,
    qualname: overrides.id,
    parent: null,
    children: [],
    loc: { files: ["src/a.ts"], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

function makeFlow(overrides: Partial<Unit> & { id: string; route: string; steps: string[] }): Unit {
  return makeUnit({
    kind: "api_flow",
    name: overrides.route,
    qualname: overrides.route,
    metrics: { hops: overrides.steps.length },
    ...overrides,
  });
}

describe("Flows", () => {
  it("lists entry points on the left, grouped by kind", () => {
    const flows = [
      makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a"] }),
      makeFlow({ id: "u:flow:2", route: "POST /orders", steps: ["u:a", "u:b"] }),
    ];
    const units = [makeUnit({ id: "u:a" }), makeUnit({ id: "u:b" })];
    render(<Flows flows={flows} units={units} edges={[]} onSelectStep={vi.fn()} />);

    expect(screen.getByText(/entry points/i)).toBeInTheDocument();
    expect(screen.getByText("GET /orders/{id}")).toBeInTheDocument();
    expect(screen.getByText("POST /orders")).toBeInTheDocument();
  });

  it("selects the first flow by default so the centre isn't empty on first load", () => {
    const flows = [makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a", "u:b"] })];
    const units = [makeUnit({ id: "u:a", name: "route_handler" }), makeUnit({ id: "u:b", name: "get_order" })];
    render(<Flows flows={flows} units={units} edges={[]} onSelectStep={vi.fn()} />);

    expect(screen.getByText("route_handler")).toBeInTheDocument();
    expect(screen.getByText("get_order")).toBeInTheDocument();
  });

  it("clicking an entry point in the left rail shows that flow's steps in the centre", () => {
    const flows = [
      makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a"] }),
      makeFlow({ id: "u:flow:2", route: "POST /orders", steps: ["u:b"] }),
    ];
    const units = [makeUnit({ id: "u:a", name: "get_handler" }), makeUnit({ id: "u:b", name: "post_handler" })];
    const { container } = render(<Flows flows={flows} units={units} edges={[]} onSelectStep={vi.fn()} />);

    fireEvent.click(screen.getByText("POST /orders"));

    expect(screen.getByText("post_handler")).toBeInTheDocument();
    expect(screen.queryByText("get_handler")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".flow-step")).toHaveLength(1);
  });

  it("shows each step's file, sloc, complexity, and one-line 'what', in call order", () => {
    const flows = [makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a", "u:b"] })];
    const units = [
      makeUnit({
        id: "u:a",
        name: "route_handler",
        loc: { files: ["src/api/routes.py"], sloc: 8 },
        cost: { complexity: 2 },
        semantics: { what: "Routes the request.", how: "", when: "", where: "", why: "", confidence: 0.9, source: "llm" },
      }),
      makeUnit({ id: "u:b", name: "get_order", loc: { files: ["src/orders/get.py"], sloc: 12 } }),
    ];
    const { container } = render(<Flows flows={flows} units={units} edges={[]} onSelectStep={vi.fn()} />);

    const steps = container.querySelectorAll(".flow-step");
    expect(steps[0]!.textContent).toMatch(/src\/api\/routes\.py/);
    expect(steps[0]!.textContent).toMatch(/8/);
    expect(steps[0]!.textContent).toMatch(/Routes the request\./);
  });

  it("labels the edge kind between consecutive steps", () => {
    const flows = [makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a", "u:b"] })];
    const units = [makeUnit({ id: "u:a" }), makeUnit({ id: "u:b" })];
    const edges = [{ id: "e1", from: "u:a", to: "u:b", kind: "calls" as const, weight: 1, source: "static" as const, confidence: 1 }];
    render(<Flows flows={flows} units={units} edges={edges} onSelectStep={vi.fn()} />);

    expect(screen.getByText("calls")).toBeInTheDocument();
  });

  it("clicking a step calls onSelectStep with that unit id", () => {
    const onSelectStep = vi.fn();
    const flows = [makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a"] })];
    const units = [makeUnit({ id: "u:a", name: "route_handler" })];
    const { container } = render(<Flows flows={flows} units={units} edges={[]} onSelectStep={onSelectStep} />);

    fireEvent.click(container.querySelector(".flow-step")!);

    expect(onSelectStep).toHaveBeenCalledWith("u:a");
  });

  it("marks a changed step with a status dot in Delta mode", () => {
    const flows = [makeFlow({ id: "u:flow:1", route: "GET /orders/{id}", steps: ["u:a", "u:b"] })];
    const units = [makeUnit({ id: "u:a" }), makeUnit({ id: "u:b" })];
    const changedStepIds = new Set(["u:a"]);
    const { container } = render(
      <Flows flows={flows} units={units} edges={[]} onSelectStep={vi.fn()} changedStepIds={changedStepIds} />,
    );

    const steps = container.querySelectorAll(".flow-step");
    expect(steps[0]!.classList.contains("changed")).toBe(true);
    expect(steps[1]!.classList.contains("changed")).toBe(false);
  });

  it("shows an empty state when the snapshot has no api_flow units", () => {
    render(<Flows flows={[]} units={[]} edges={[]} onSelectStep={vi.fn()} />);
    expect(screen.getByText(/no entry points/i)).toBeInTheDocument();
  });
});
