import { useMemo, useState } from "react";
import type { Unit } from "@scv/schema";

export type UnitSearchProps = {
  units: Unit[];
  /** Called with the chosen unit's id — the caller decides whether that means select or drill. */
  onPick: (unitId: string) => void;
};

/**
 * Enough results to choose from, few enough to read without the list covering the canvas it
 * is meant to help you navigate.
 */
const MAX_RESULTS = 10;

const boxStyle = {
  width: 180,
  height: 24,
  padding: "0 8px",
  font: "var(--text-xs)",
  color: "var(--text-1)",
  background: "var(--surface-1)",
  border: "var(--border-w) solid var(--border-hair)",
  borderRadius: "var(--radius-ctl)",
} as const;

const listStyle = {
  position: "absolute",
  top: "100%",
  right: 0,
  zIndex: 10,
  minWidth: 180,
  maxWidth: 320,
  marginTop: 4,
  padding: 4,
  background: "var(--surface-1)",
  border: "var(--border-w) solid var(--border-hair)",
  borderRadius: "var(--radius-ctl)",
  boxShadow: "var(--shadow-tray)",
  listStyle: "none",
} as const;

/**
 * Jump to a unit by name.
 *
 * The drill hierarchy is the only way to reach a unit otherwise, and on a repository deep
 * enough to have one it is the slow way: you have to know which of fifteen top-level groups
 * owns the file before you can start. Searching by name skips the tree entirely, which is
 * what makes a large repository navigable at all while the clustering cap is still pending.
 *
 * Matching is a case-insensitive substring rather than a prefix, because module names are
 * path-like and the memorable part is rarely at the front.
 */
export function UnitSearch({ units, onPick }: UnitSearchProps): JSX.Element {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return units.filter((u) => u.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [units, query]);

  const pick = (unitId: string) => {
    setQuery("");
    onPick(unitId);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        type="search"
        aria-label="find a unit"
        placeholder="Find…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={boxStyle}
      />
      {query.trim() !== "" && (
        <ul role="listbox" aria-label="search results" style={listStyle}>
          {matches.length === 0 ? (
            <li style={{ padding: "4px 6px", font: "var(--text-xs)", color: "var(--text-faint)" }}>No matches</li>
          ) : (
            matches.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(u.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "4px 6px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    font: "var(--text-xs)",
                    color: "var(--text-1)",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {u.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
