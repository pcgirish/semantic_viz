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
});
