import { Button, PathBreadcrumb } from "@scv/design-system";
import type { Unit } from "@scv/schema";
import { isDomainId } from "./App.js";

export type BreadcrumbProps = {
  focus: string | null;
  focusStack: string[];
  units: Unit[];
  onGoTo: (index: number) => void;
  onBack: () => void;
};

/** Resolves the focus/focusStack drill path to breadcrumb segment labels — shared so the
 *  flowchart breadcrumb (App.tsx) can extend the real drill path with a trailing function
 *  segment instead of hardcoding its own fixed-depth path. */
export function focusPathSegments(focus: string | null, focusStack: string[], units: Unit[]): { label: string }[] {
  if (focus === null) return [];
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const path = [...focusStack, focus];
  // A synthetic domain id (`group:<name>`) has no matching real unit — label it from the id.
  return path.map((id) => ({ label: isDomainId(id) ? id.slice("group:".length) : (unitsById.get(id)?.name ?? id) }));
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
