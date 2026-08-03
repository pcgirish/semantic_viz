import { useState } from "react";

/** git's default abbreviated-sha length — enough to disambiguate, short enough to scan. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export type ReplayRev = {
  sha: string;
  kind: string;
  pr?: number;
  message?: string;
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
  const currentPr = revs.find((r) => r.sha === sha)?.pr;
  const hasPrs = revs.some((r) => r.kind === "pr");
  const [dense, setDense] = useState(false);

  // Replay is a lens on "what happened in this PR", never the whole repo history — both
  // modes scope to the current rev's own PR (branch point to head) when rev.pr is
  // available. Falls back to every rev only when the repo has no PR data at all (e.g. a
  // fixture that predates rev.pr) — otherwise the default view would silently show
  // nothing rather than the commit-level track the mock always renders.
  const scoped = currentPr !== undefined ? revs.filter((r) => r.pr === currentPr) : revs;
  const shown = dense || !hasPrs ? scoped : scoped.filter((r) => r.kind === "pr");
  const chronological = [...shown].sort((a, b) => a.ts.localeCompare(b.ts));
  const current = revs.find((r) => r.sha === sha);

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
            className={`replay-rev author-${r.author_kind}${r.sha === sha ? " active" : ""}`}
            onClick={() => onScrub(r.sha)}
          >
            <div
              data-testid="replay-bar"
              className={`replay-bar author-${r.author_kind}${r.sha === sha ? " active" : ""}`}
              style={{ "--amount": String(r.amount ?? 0) } as React.CSSProperties}
              title={`${r.sha} · ${r.author} · amount ${(r.amount ?? 0).toFixed(2)}`}
            />
            <div className="replay-dot" />
            <div className="replay-cap">{shortSha(r.sha)}</div>
          </div>
        ))}
      </div>
      {current && (
        <div className="replay-meta">
          {current.message && <strong>{current.message}</strong>}
          {current.author} · {current.author_kind}
        </div>
      )}
    </div>
  );
}
