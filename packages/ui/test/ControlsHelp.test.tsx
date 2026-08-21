import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ControlsHelp } from "../src/ControlsHelp.js";

afterEach(cleanup);

describe("ControlsHelp", () => {
  it("says nothing for the 2D skin, which needs no camera instructions", () => {
    const { container } = render(<ControlsHelp skin="tiles" view="orbit" />);
    expect(container.innerHTML).toBe("");
  });

  it("describes orbit-drag and scroll-zoom for tiles3d", () => {
    render(<ControlsHelp skin="tiles3d" view="orbit" />);
    const help = screen.getByTestId("controls-help");
    expect(within(help).getByText(/orbit/i)).toBeInTheDocument();
    expect(within(help).getByText(/scroll/i)).toBeInTheDocument();
  });

  it("describes flying, not walking, for the cityscape overview", () => {
    render(<ControlsHelp skin="cityscape" view="orbit" />);
    const help = screen.getByTestId("controls-help");
    expect(within(help).getByText(/WASD/)).toBeInTheDocument();
    // Fly mode looks by dragging; it never captures the pointer.
    expect(within(help).queryByText(/Esc/)).toBeNull();
  });

  it("describes pointer lock and its release for cityscape at street level", () => {
    render(<ControlsHelp skin="cityscape" view="street" />);
    const help = screen.getByTestId("controls-help");
    expect(within(help).getByText(/WASD/)).toBeInTheDocument();
    expect(within(help).getByText(/Esc/)).toBeInTheDocument();
  });

  it("tells the walker that flying towards a building opens it", () => {
    // Zoom-to-drill has no visible affordance of its own — the camera moving *is* the
    // gesture — so it is only discoverable if the help says it exists.
    render(<ControlsHelp skin="cityscape" view="street" />);
    expect(within(screen.getByTestId("controls-help")).getByText(/close to a building/i)).toBeInTheDocument();
  });
});
