import { useState } from "react";

export type ReplayRev = {
  sha: string;
  kind: string;
  ts: string;
  author: string;
  author_kind: string;
  amount: number;
};

export type ReplayProps = {
  revs: ReplayRev[];
  sha: string;
  onScrub: (sha: string) => void;
};

/**
 * Rev timeline scrubber (docs/serve.md#4 "Replay"). PR-level by default, commit-level as
 * a density toggle. Bars are per-rev amount; human/agent commits get a distinct class
 * because "which of these did a person write" is a question reviewers actually ask.
 *
 * Position tweening between revs' layouts is out of scope here — no seeded animated
 * layout engine exists yet, so scrubbing jumps directly and only the bar/active state
 * animates.
 */
export function Replay({ revs, sha, onScrub }: ReplayProps): JSX.Element {
  const [dense, setDense] = useState(false);

  const shown = dense ? revs : revs.filter((r) => r.kind === "pr");
  const chronological = [...shown].sort((a, b) => a.ts.localeCompare(b.ts));

  return (
    <div className="replay">
      <div className="replay-controls">
        <button type="button" aria-pressed={!dense} onClick={() => setDense(false)}>
          PR
        </button>
        <button type="button" aria-pressed={dense} onClick={() => setDense(true)}>
          Commit
        </button>
      </div>
      <div className="replay-track">
        {chronological.map((r) => (
          <div
            key={r.sha}
            data-testid="replay-bar"
            className={`replay-bar author-${r.author_kind}${r.sha === sha ? " active" : ""}`}
            style={{ "--amount": String(r.amount) } as React.CSSProperties}
            title={`${r.sha} · ${r.author} · amount ${r.amount.toFixed(2)}`}
            onClick={() => onScrub(r.sha)}
          />
        ))}
      </div>
    </div>
  );
}
