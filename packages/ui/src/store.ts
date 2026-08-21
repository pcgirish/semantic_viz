import { create } from "zustand";

export type Mode = "current" | "delta" | "depends" | "flows";

/** Which skin draws the canvas (docs/serve.md#6). In-memory only — there are no persisted UI prefs. */
export type RenderSkin = "tiles" | "tiles3d" | "cityscape";

/**
 * Which way a 3D camera looks at the city: down at it, or from inside it (docs/serve.md#6).
 *
 * Store state rather than canvas-local state because the controls legend that explains the
 * current camera renders in App's left rail — a sibling of the canvas, which cannot read
 * state held inside it. It is a skin-independent slice for the same reason `renderSkin` is:
 * switching skins mid-walk should not eject you into the sky.
 */
export type ViewMode = "orbit" | "street";

export type AppState = {
  selection: string | null;
  focus: string | null;
  mode: Mode;
  rev: string | null;
  focusStack: string[];
  renderSkin: RenderSkin;
  view: ViewMode;
  select: (unitId: string | null) => void;
  drill: (unitId: string) => void;
  ascend: () => void;
  goTo: (index: number) => void;
  setMode: (mode: Mode) => void;
  setRev: (rev: string | null) => void;
  setRenderSkin: (skin: RenderSkin) => void;
  setView: (view: ViewMode) => void;
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
  // Both 3D skins start pulled back. For tiles3d that is the literal orbit camera; for
  // cityscape it is the fly camera framed on the whole city. Either way you arrive able to
  // see the rank axis, and walk only once you have chosen somewhere to walk to.
  view: "orbit",
  select: (unitId) => set({ selection: unitId }),
  // Its own orthogonal slice: switching skins must not disturb selection or focus, so you
  // land in the 3D view looking at the same unit you were looking at in 2D.
  setRenderSkin: (skin) => set({ renderSkin: skin }),
  setView: (view) => set({ view }),
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
