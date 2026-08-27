import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ConnectorLayer } from "@scv/design-system";

afterEach(cleanup);

/**
 * Parses the vertical run lengths out of an ortho-v path. The elbow shape is
 * `V <a> Q .. H .. Q .. V <b>`: the path leaves the source toward `clearY`, jogs
 * sideways, then continues to the target. Both vertical runs must travel the same
 * way the endpoints do — if a corner radius is applied with the wrong sign the run
 * overshoots `clearY` and the path visibly doubles back on itself.
 */
function verticalTargets(d: string): number[] {
  return [...d.matchAll(/V (-?[\d.]+)/g)].map((m) => Number(m[1]));
}

describe("ConnectorLayer ortho-v elbow", () => {
  function pathFor(edge: Record<string, unknown>): string {
    const { container } = render(
      <ConnectorLayer edges={[{ kind: "import", ...edge }]} route="ortho-v" />,
    );
    // The first non-marker path is the connector itself; arrowhead markers live in <defs>.
    const paths = [...container.querySelectorAll("path")].filter(
      (p) => !p.closest("defs"),
    );
    return paths[0]!.getAttribute("d")!;
  }

  it("does not double back when the path runs upward (dependency above dependent)", () => {
    // create_order.py (y=200) -> pricing.py (y=0): the dependency renders above, so the
    // path climbs. Both vertical runs must decrease in y.
    const d = pathFor({ x1: 100, y1: 200, x2: 20, y2: 0, clearY: 100 });
    const [first, second] = verticalTargets(d);

    expect(first).toBeLessThan(200); // leaves the source going up
    expect(first).toBeGreaterThan(100); // stops short of clearY, does not overshoot past it
    expect(second).toBe(0); // arrives at the target
  });

  it("still runs cleanly downward for the Flowchart view's control flow", () => {
    const d = pathFor({ x1: 20, y1: 0, x2: 100, y2: 200, clearY: 100 });
    const [first, second] = verticalTargets(d);

    expect(first).toBeGreaterThan(0); // leaves the source going down
    expect(first).toBeLessThan(100); // stops short of clearY
    expect(second).toBe(200);
  });

  it("keeps the elbow's corner on the near side of clearY in both directions", () => {
    const up = verticalTargets(pathFor({ x1: 100, y1: 200, x2: 20, y2: 0, clearY: 100 }));
    const down = verticalTargets(pathFor({ x1: 20, y1: 0, x2: 100, y2: 200, clearY: 100 }));

    // Same geometry mirrored: the first run should stop the same distance from clearY.
    expect(Math.abs(up[0]! - 100)).toBeCloseTo(Math.abs(down[0]! - 100));
  });
});

describe("ConnectorLayer: focus dimming", () => {
  /** Renders one edge under a focus that puts it outside `near`, so edgeRole calls it "muted". */
  function opacityOf(kind: string): string | null {
    const { container } = render(
      <ConnectorLayer
        edges={[{ x1: 0, y1: 0, x2: 50, y2: 0, from: "a", to: "b", kind }]}
        focus={{ id: "z", near: ["z"], far: [] }}
      />,
    );
    return container.querySelector("svg path[stroke]")!.getAttribute("opacity");
  }

  it("dims an edge outside the focus", () => {
    expect(opacityOf("import")).toBe("var(--focus-dim-edge)");
  });
});
