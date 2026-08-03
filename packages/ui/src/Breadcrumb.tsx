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

  return (
    <div className="crumb-bar">
      <button type="button" className="back-btn" onClick={onBack}>
        ‹ Back
      </button>
      <div id="crumb">
        {path.map((id, i) => {
          const name = unitsById.get(id)?.name ?? id;
          const isLast = i === path.length - 1;
          return (
            <span key={id}>
              {i > 0 && <i>›</i>}
              {isLast ? (
                <span className="here">{name}</span>
              ) : (
                <button type="button" onClick={() => onGoTo(i)}>
                  {name}
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
