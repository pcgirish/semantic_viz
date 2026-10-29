import { Button, PathBreadcrumb } from "@semviz/design-system";
import { displayName } from "@semviz/layout";
import type { Unit } from "@semviz/schema";

export type BreadcrumbProps = {
  focus: string | null;
  focusStack: string[];
  units: Unit[];
  onGoTo: (index: number) => void;
  onBack: () => void;
};

/** A module's name is its repo-relative path; spelled out in full it crowds every other
 *  segment off the toolbar, so the crumb shows the file name (the same leaf the tiles show)
 *  and keeps the full path as hover text. */
function segmentFor(unit: Unit | undefined, id: string): { label: string; title?: string } {
  if (!unit) return { label: id };
  const label = displayName(unit);
  return label === unit.name ? { label } : { label, title: unit.name };
}

/** Resolves the focus/focusStack drill path to breadcrumb segment labels — shared so the
 *  flowchart breadcrumb (App.tsx) can extend the real drill path with a trailing function
 *  segment instead of hardcoding its own fixed-depth path. */
export function focusPathSegments(
  focus: string | null,
  focusStack: string[],
  units: Unit[],
): { label: string; title?: string }[] {
  if (focus === null) return [];
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const path = [...focusStack, focus];
  return path.map((id) => segmentFor(unitsById.get(id), id));
}

/** Path from root to the current focus, plus a back button — mirrors the mock's #crumb (docs/mock/scv-mock.html). */
export function Breadcrumb({ focus, focusStack, units, onGoTo, onBack }: BreadcrumbProps): JSX.Element | null {
  if (focus === null) return null;

  const path = [...focusStack, focus];
  const segments = focusPathSegments(focus, focusStack, units);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--gap-md)" }}>
      <Button variant="ghost" size="sm" onClick={onBack}>
        ‹ Back
      </Button>
      <PathBreadcrumb
        segments={segments}
        onPick={(i) => {
          if (i < path.length - 1) onGoTo(i);
        }}
      />
    </div>
  );
}
