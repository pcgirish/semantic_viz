import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Canvas3dHost } from "../src/Canvas3dHost.js";
import type { Edge, Unit } from "@scv/schema";

const units = [
  { id: "a", name: "a", kind: "module", layer: "edge", group: "g", loc: { sloc: 10 }, complexity: 2, risk: 0 },
  { id: "b", name: "b", kind: "module", layer: "domain", group: "g", loc: { sloc: 40 }, complexity: 5, risk: 0 },
] as unknown as Unit[];
const edges = [{ from: "a", to: "b", kind: "imports", weight: 1 }] as unknown as Edge[];

describe("Canvas3dHost", () => {
  afterEach(() => {
    cleanup();
  });

  // jsdom has no WebGL, so this asserts the host degrades rather than throwing. The object
  // graph, camera framing, and disposal are covered directly in scene3d.test.ts.
  it("mounts without a WebGL context and renders its container", () => {
    const { getByTestId } = render(<Canvas3dHost units={units} edges={edges} />);
    expect(getByTestId("canvas-3d")).toBeTruthy();
  });

  it("offers a street/overview toggle, so the camera model is switchable", () => {
    const { getByRole } = render(<Canvas3dHost units={units} edges={edges} />);
    expect(getByRole("button", { name: /street view/i })).toBeTruthy();
  });

  it("unmounts cleanly", () => {
    const { unmount, getByTestId } = render(<Canvas3dHost units={units} edges={edges} />);
    expect(getByTestId("canvas-3d")).toBeTruthy();
    expect(() => unmount()).not.toThrow();
  });

  it("shows the minimap for a walkable skin, because rank is invisible at eye level", () => {
    // Checkpoint 2's second question: standing among the buildings there is no visual answer
    // to "which way is up the dependency graph?". The map is the only instrument that can
    // give one, which is why it renders as part of the walkable view rather than as an
    // optional inset the user has to find (docs/serve.md#189).
    const { getByTestId } = render(<Canvas3dHost units={units} edges={edges} skin="cityscape" />);
    expect(getByTestId("minimap")).toBeTruthy();
  });

  it("omits the minimap from the orbit skin, which can already see rank", () => {
    // From orbit the rank axis reads at a glance — the map would be redundant chrome over a
    // view that has not lost anything.
    const { queryByTestId } = render(<Canvas3dHost units={units} edges={edges} skin="tiles3d" />);
    expect(queryByTestId("minimap")).toBeNull();
  });

  it("labels its camera toggle in the walkable skin's own terms", () => {
    // tiles3d switches between looking at the city and standing in it. cityscape is always
    // inside it, and switches how you travel: on foot or airborne.
    const { getByRole } = render(<Canvas3dHost units={units} edges={edges} skin="cityscape" />);
    expect(getByRole("button", { name: /walk/i })).toBeTruthy();
  });

  it("starts the walkable skin airborne, not on the pavement", () => {
    // Fly is the arrival mode: it keeps the whole city — and therefore the rank axis — in
    // view, which is exactly what Checkpoint 2 found street level destroys. Landing the user
    // between two buildings with no overview reproduces the failure the minimap exists to
    // mitigate, before they have been given any reason to walk. Travel first, arrive second
    // (docs/serve.md#6). The toggle offering "Walk" is the observable form of that default.
    const { getByRole, queryByRole } = render(<Canvas3dHost units={units} edges={edges} skin="cityscape" />);
    expect(getByRole("button", { name: /walk/i })).toBeTruthy();
    expect(queryByRole("button", { name: /^fly$/i })).toBeNull();
  });
});
