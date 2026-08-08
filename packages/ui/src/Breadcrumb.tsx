import { Button, PathBreadcrumb } from "@scv/design-system";
import type { Unit } from "@scv/schema";

export type BreadcrumbProps = {
  focus: string | null;
  focusStack: string[];
  units: Unit[];
  onGoTo: (index: number) => void;
  onBack: () => void;
};

/** Path from root to the current focus, plus a back button — mirrors the mock's #crumb (docs/mock/scv-mock.html). */
export function Breadcrumb({ focus, focusStack, units, onGoTo, onBack }: BreadcrumbProps): JSX.Element | null {
  if (focus === null) return null;

  const unitsById = new Map(units.map((u) => [u.id, u]));
  const path = [...focusStack, focus];
  const segments = path.map((id) => ({ label: unitsById.get(id)?.name ?? id }));

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
