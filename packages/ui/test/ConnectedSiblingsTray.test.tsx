import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConnectedSiblingsTray } from "../src/ConnectedSiblingsTray.js";
import type { SiblingSummary } from "../src/App.js";

function row(overrides: Partial<SiblingSummary> & { id: string }): SiblingSummary {
  return {
    name: overrides.id,
    tiles: [],
    inCount: 0,
    outCount: 0,
    edgeCount: 0,
    direction: null,
    ...overrides,
  };
}

const noop = () => {};

afterEach(() => cleanup());

describe("ConnectedSiblingsTray", () => {
  it("renders nothing when the focused unit has no siblings", () => {
    const { container } = render(
      <ConnectedSiblingsTray siblings={[]} pinned={null} onHover={noop} onTogglePin={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per sibling, in the order given", () => {
    render(
      <ConnectedSiblingsTray
        siblings={[
          row({ id: "g2", name: "Billing", edgeCount: 3, outCount: 3, direction: "out" }),
          row({ id: "g3", name: "Auth", edgeCount: 1, inCount: 1, direction: "in" }),
          row({ id: "g4", name: "Docs" }),
        ]}
        pinned={null}
        onHover={noop}
        onTogglePin={noop}
      />,
    );

    const ids = [...screen.getAllByTestId(/^sibling-row-/)].map((el) => el.dataset.testid ?? el.getAttribute("data-testid"));
    expect(ids).toEqual(["sibling-row-g2", "sibling-row-g3", "sibling-row-g4"]);
  });

  it("distinguishes the three directions by glyph", () => {
    render(
      <ConnectedSiblingsTray
        siblings={[
          row({ id: "out", edgeCount: 1, outCount: 1, direction: "out" }),
          row({ id: "in", edgeCount: 1, inCount: 1, direction: "in" }),
          row({ id: "both", edgeCount: 2, inCount: 1, outCount: 1, direction: "both" }),
        ]}
        pinned={null}
        onHover={noop}
        onTogglePin={noop}
      />,
    );

    const glyph = (id: string) => screen.getByTestId(`sibling-row-${id}`).querySelector("span")!.textContent;
    expect(new Set([glyph("out"), glyph("in"), glyph("both")]).size).toBe(3);
  });

  it("shows an uncoupled sibling as an inert 'no links' row rather than hiding it", () => {
    const onHover = vi.fn();
    const onTogglePin = vi.fn();
    render(
      <ConnectedSiblingsTray
        siblings={[row({ id: "g4", name: "Docs" })]}
        pinned={null}
        onHover={onHover}
        onTogglePin={onTogglePin}
      />,
    );

    const el = screen.getByTestId("sibling-row-g4");
    expect(el.textContent).toContain("no links");
    expect(el.dataset.linked).toBe("false");

    // Inert: there is nothing to highlight, so hovering or clicking must not pretend otherwise.
    fireEvent.mouseEnter(el);
    fireEvent.click(el);
    expect(onHover).not.toHaveBeenCalled();
    expect(onTogglePin).not.toHaveBeenCalled();
  });

  it("reports hover and click on a coupled row, and marks the pinned one", () => {
    const onHover = vi.fn();
    const onTogglePin = vi.fn();
    const { rerender } = render(
      <ConnectedSiblingsTray
        siblings={[row({ id: "g2", name: "Billing", edgeCount: 2, outCount: 2, direction: "out" })]}
        pinned={null}
        onHover={onHover}
        onTogglePin={onTogglePin}
      />,
    );

    const el = screen.getByTestId("sibling-row-g2");
    fireEvent.mouseEnter(el);
    expect(onHover).toHaveBeenCalledWith("g2");
    fireEvent.click(el);
    expect(onTogglePin).toHaveBeenCalledWith("g2");
    expect(el.dataset.pinned).toBeUndefined();

    rerender(
      <ConnectedSiblingsTray
        siblings={[row({ id: "g2", name: "Billing", edgeCount: 2, outCount: 2, direction: "out" })]}
        pinned="g2"
        onHover={onHover}
        onTogglePin={onTogglePin}
      />,
    );
    expect(screen.getByTestId("sibling-row-g2").dataset.pinned).toBe("true");
  });

  it("clears the hover when the pointer leaves the tray", () => {
    const onHover = vi.fn();
    render(
      <ConnectedSiblingsTray
        siblings={[row({ id: "g2", edgeCount: 1, outCount: 1, direction: "out" })]}
        pinned={null}
        onHover={onHover}
        onTogglePin={noop}
      />,
    );

    fireEvent.mouseLeave(screen.getByTestId("connected-siblings-tray"));
    expect(onHover).toHaveBeenCalledWith(null);
  });
});
