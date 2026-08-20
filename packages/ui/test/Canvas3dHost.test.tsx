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
});
