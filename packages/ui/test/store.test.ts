import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../src/store.js";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it("starts with no selection, no focus, current mode, and no rev", () => {
    const s = useAppStore.getState();
    expect(s.selection).toBeNull();
    expect(s.focus).toBeNull();
    expect(s.mode).toBe("current");
    expect(s.rev).toBeNull();
  });

  it("select sets the selection", () => {
    useAppStore.getState().select("u:a");
    expect(useAppStore.getState().selection).toBe("u:a");
  });

  it("drill sets focus to the drilled-into unit and clears selection", () => {
    useAppStore.getState().select("u:a");
    useAppStore.getState().drill("u:layer:x");
    expect(useAppStore.getState().focus).toBe("u:layer:x");
    expect(useAppStore.getState().selection).toBeNull();
  });

  it("ascend pops the focus stack, back to root (null) when empty", () => {
    useAppStore.getState().drill("u:layer:x");
    useAppStore.getState().drill("u:module:y");
    useAppStore.getState().ascend();
    expect(useAppStore.getState().focus).toBe("u:layer:x");
    useAppStore.getState().ascend();
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("setMode toggles between current and delta", () => {
    useAppStore.getState().setMode("delta");
    expect(useAppStore.getState().mode).toBe("delta");
  });

  it("setRev sets the active revision", () => {
    useAppStore.getState().setRev("abc123");
    expect(useAppStore.getState().rev).toBe("abc123");
  });

  it("goTo jumps to an ancestor in the focus stack, truncating the stack past it", () => {
    useAppStore.getState().drill("u:layer:x");
    useAppStore.getState().drill("u:module:y");
    useAppStore.getState().drill("u:class:z");
    useAppStore.getState().goTo(1);
    expect(useAppStore.getState().focus).toBe("u:module:y");
    expect(useAppStore.getState().focusStack).toEqual(["u:layer:x"]);
  });

  it("goTo(0) jumps to the first drilled unit with an empty stack", () => {
    useAppStore.getState().drill("u:layer:x");
    useAppStore.getState().drill("u:module:y");
    useAppStore.getState().goTo(0);
    expect(useAppStore.getState().focus).toBe("u:layer:x");
    expect(useAppStore.getState().focusStack).toEqual([]);
  });

  it("goTo is a no-op when index is at or past the current stack length", () => {
    useAppStore.getState().drill("u:layer:x");
    useAppStore.getState().drill("u:module:y");
    const before = useAppStore.getState();
    useAppStore.getState().goTo(1);
    expect(useAppStore.getState().focus).toBe(before.focus);
    expect(useAppStore.getState().focusStack).toEqual(before.focusStack);
  });

  it("drill into a function unit sets focus like any other unit and clears selection", () => {
    useAppStore.getState().select("u:a");
    useAppStore.getState().drill("u:fn:create_order");
    const s = useAppStore.getState();
    expect(s.focus).toBe("u:fn:create_order");
    expect(s.selection).toBeNull();
    expect(s.mode).toBe("current");
  });

  it("ascend out of a function focus leaves mode untouched", () => {
    useAppStore.getState().setMode("delta");
    useAppStore.getState().drill("u:fn:create_order");
    useAppStore.getState().ascend();
    const s = useAppStore.getState();
    expect(s.mode).toBe("delta");
    expect(s.focus).toBeNull();
  });

  it("goTo past a function focus also leaves mode untouched", () => {
    useAppStore.getState().drill("u:layer:x");
    useAppStore.getState().drill("u:module:y");
    useAppStore.getState().setMode("delta");
    useAppStore.getState().drill("u:fn:create_order");
    useAppStore.getState().goTo(0);
    const s = useAppStore.getState();
    expect(s.mode).toBe("delta");
    expect(s.focus).toBe("u:layer:x");
    expect(s.focusStack).toEqual([]);
  });

  it("ascend pops the focus stack regardless of mode", () => {
    useAppStore.getState().drill("u:layer:x");
    useAppStore.getState().drill("u:module:y");
    useAppStore.getState().ascend();
    expect(useAppStore.getState().focus).toBe("u:layer:x");
    expect(useAppStore.getState().mode).toBe("current");
  });
});

describe("renderSkin", () => {
  it("defaults to the 2D tiles skin", () => {
    expect(useAppStore.getState().renderSkin).toBe("tiles");
  });

  it("switches skin without disturbing selection, focus, or the focus stack", () => {
    useAppStore.getState().drill("mod-a");
    useAppStore.getState().select("mod-a");
    const before = useAppStore.getState();
    const { focus, focusStack, selection } = before;

    useAppStore.getState().setRenderSkin("tiles3d");

    const after = useAppStore.getState();
    expect(after.renderSkin).toBe("tiles3d");
    expect(after.focus).toBe(focus);
    expect(after.focusStack).toEqual(focusStack);
    expect(after.selection).toBe(selection);
  });
});
