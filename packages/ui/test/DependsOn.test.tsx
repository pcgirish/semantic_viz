import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { External } from "@semviz/schema";
import { DependsOn } from "../src/DependsOn.js";

afterEach(cleanup);

function makeExternal(overrides: Partial<External> & { id: string; name: string }): External {
  return {
    ecosystem: "pypi",
    version: "1.0.0",
    direct: true,
    depth: 1,
    reached_by: [],
    transitive_count: null,
    ...overrides,
  };
}

describe("DependsOn", () => {
  it("renders one row per depth, direct at the top", () => {
    const externals = [
      makeExternal({ id: "x:pypi:a@1", name: "a", depth: 1 }),
      makeExternal({ id: "x:pypi:b@1", name: "b", depth: 2, direct: false, transitive_count: 3 }),
    ];
    const { container } = render(<DependsOn externals={externals} onSelect={vi.fn()} />);

    const rows = container.querySelectorAll(".dep-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/depth 1/i);
    expect(rows[0]!.textContent).toMatch(/direct/i);
    expect(rows[1]!.textContent).toMatch(/depth 2/i);
    expect(rows[1]!.textContent).toMatch(/transitive/i);
  });

  it("orders rows depth ascending — direct (shallowest) first, deepest last", () => {
    const externals = [
      makeExternal({ id: "x:pypi:c@1", name: "c", depth: 3, direct: false }),
      makeExternal({ id: "x:pypi:a@1", name: "a", depth: 1 }),
      makeExternal({ id: "x:pypi:b@1", name: "b", depth: 2, direct: false }),
    ];
    const { container } = render(<DependsOn externals={externals} onSelect={vi.fn()} />);

    const depths = [...container.querySelectorAll(".dep-row")].map((r) => r.getAttribute("data-depth"));
    expect(depths).toEqual(["1", "2", "3"]);
  });

  it("sizes each external's circle by transitive_count, so a widely-used dependency reads as bigger", () => {
    const externals = [
      makeExternal({ id: "x:pypi:small@1", name: "small", depth: 1, transitive_count: 1 }),
      makeExternal({ id: "x:pypi:big@1", name: "big", depth: 1, transitive_count: 25 }),
    ];
    const { container } = render(<DependsOn externals={externals} onSelect={vi.fn()} />);

    const circles = container.querySelectorAll(".dep-row svg circle");
    const radii = Array.from(circles).map((c) => Number(c.getAttribute("r")));
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });

  it("clicking an external calls onSelect with its id", () => {
    const onSelect = vi.fn();
    const externals = [makeExternal({ id: "x:pypi:redis@5", name: "redis", depth: 1 })];
    const { container } = render(<DependsOn externals={externals} onSelect={onSelect} />);

    fireEvent.click(container.querySelector(".dep-row svg g")!);

    expect(onSelect).toHaveBeenCalledWith("x:pypi:redis@5");
  });

  it("shows the external's name and version on hover", () => {
    const externals = [makeExternal({ id: "x:pypi:redis@5", name: "redis", version: "5.0.1", depth: 1 })];
    const { container } = render(<DependsOn externals={externals} onSelect={vi.fn()} />);

    fireEvent.mouseEnter(container.querySelector(".dep-row svg + div > span")!);

    expect(container.textContent).toMatch(/redis/);
    expect(container.textContent).toMatch(/5\.0\.1/);
  });

  it("shows an empty state when there are no externals at all", () => {
    render(<DependsOn externals={[]} onSelect={vi.fn()} />);

    expect(screen.getByText(/no external dependencies/i)).toBeInTheDocument();
  });
});
