import { create } from "zustand";

export type Mode = "current" | "delta" | "depends" | "flows";

export type AppState = {
  selection: string | null;
  focus: string | null;
  mode: Mode;
  rev: string | null;
  focusStack: string[];
  select: (unitId: string | null) => void;
  drill: (unitId: string) => void;
  ascend: () => void;
  goTo: (index: number) => void;
  setMode: (mode: Mode) => void;
  setRev: (rev: string | null) => void;
};

// docs/implement-serve.md stack: "Selection, focus, mode, rev are four small orthogonal
// slices." drill/ascend keep a stack so ascending always returns to the exact parent,
// not just "one level up" by some other rule (breadcrumb navigation, docs/serve.md#4).
export const useAppStore = create<AppState>((set) => ({
  selection: null,
  focus: null,
  mode: "current",
  rev: null,
  focusStack: [],
  select: (unitId) => set({ selection: unitId }),
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
