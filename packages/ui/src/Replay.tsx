import { useState } from "react";
import { Button, CommitTimeline } from "@scv/design-system";

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
  const selectedIndex = chronological.findIndex((r) => r.sha === sha);

  // CommitTimeline colors bars by temperature, not an author class — reuse that axis to
  // keep the human/agent distinction: agent commits render one stop warmer.
  const authorTemp = (kind: string): number => (kind === "agent" ? 2 : 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-md)" }}>
      <div style={{ display: "flex", gap: "var(--gap-sm)" }}>
        <Button variant={dense ? "ghost" : "solid"} size="sm" aria-pressed={!dense} onClick={() => setDense(false)}>
          PR
        </Button>
        <Button variant={dense ? "solid" : "ghost"} size="sm" aria-pressed={dense} onClick={() => setDense(true)}>
          Commit
        </Button>
      </div>
      <CommitTimeline
        commits={chronological.map((r) => ({
          sha: r.sha,
          message: `${r.sha} · ${r.author} · amount ${(r.amount ?? 0).toFixed(2)}`,
          churn: (r.amount ?? 0) * 60,
          temp: authorTemp(r.author_kind),
        }))}
        value={selectedIndex}
        onChange={(i) => {
          const rev = chronological[i];
          if (rev) onScrub(rev.sha);
        }}
      />
      <div style={{ display: "flex", gap: "var(--gap-md)", font: "var(--type-metric)", color: "var(--text-faint)" }}>
        {chronological.map((r) => (
          <span key={r.sha}>{shortSha(r.sha)}</span>
        ))}
      </div>
      {current && (
        <div style={{ font: "var(--type-ui)", color: "var(--text-dim)" }}>
          {current.message && <strong style={{ color: "var(--text-hi)" }}>{current.message}</strong>}{" "}
          {current.author} · {current.author_kind}
        </div>
      )}
    </div>
  );
}
