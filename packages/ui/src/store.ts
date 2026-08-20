import { create } from "zustand";

export type Mode = "current" | "delta" | "depends" | "flows";

/** Which skin draws the canvas (docs/serve.md#6). In-memory only — there are no persisted UI prefs. */
export type RenderSkin = "tiles" | "tiles3d" | "cityscape";

export type AppState = {
  selection: string | null;
  focus: string | null;
  mode: Mode;
  rev: string | null;
  focusStack: string[];
  renderSkin: RenderSkin;
  select: (unitId: string | null) => void;
  drill: (unitId: string) => void;
  ascend: () => void;
  goTo: (index: number) => void;
  setMode: (mode: Mode) => void;
  setRev: (rev: string | null) => void;
  setRenderSkin: (skin: RenderSkin) => void;
};

// docs/implement-serve.md stack: "Selection, focus, mode, rev are four small orthogonal
// slices." drill/ascend keep a stack so ascending always returns to the exact parent,
// not just "one level up" by some other rule (breadcrumb navigation, docs/serve.md#4).
// A function unit is a drillable zoom level like any other — App.tsx renders it as a
// Flowchart instead of a CanvasHost tile grid, but focus/focusStack/ascend/goTo all treat
// it the same as drilling into a layer or module.
export const useAppStore = create<AppState>((set) => ({
  selection: null,
  focus: null,
  mode: "current",
  rev: null,
  focusStack: [],
  renderSkin: "tiles",
  select: (unitId) => set({ selection: unitId }),
  // Its own orthogonal slice: switching skins must not disturb selection or focus, so you
  // land in the 3D view looking at the same unit you were looking at in 2D.
  setRenderSkin: (skin) => set({ renderSkin: skin }),
  drill: (unitId) =>
    set((s) => ({
      focusStack: s.focus === null ? s.focusStack : [...s.focusStack, s.focus],
      focus: unitId,
      selection: null,
    })),
  ascend: () =>
    set((s) => {
      const stack = [...s.focusStack];
      const parent = stack.pop() ?? null;
      return { focusStack: stack, focus: parent };
    }),
  goTo: (index) =>
    set((s) => {
      if (index >= s.focusStack.length) return {};
      return { focus: s.focusStack[index]!, focusStack: s.focusStack.slice(0, index) };
    }),
  setMode: (mode) => set({ mode }),
  setRev: (rev) => set({ rev }),
}));
