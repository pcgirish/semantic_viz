import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Replay, type ReplayRev } from "../src/Replay.js";

afterEach(cleanup);

function makeRevs(): ReplayRev[] {
  return [
    { sha: "ccc", kind: "commit", ts: "2026-01-03T00:00:00Z", author: "Ada", author_kind: "human", amount: 0.1 },
    { sha: "bbb", kind: "pr", ts: "2026-01-02T00:00:00Z", author: "agent", author_kind: "agent", amount: 0.8 },
    { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
  ];
}

/** CommitTimeline renders one <button> per commit, titled with the commit's message text. */
function trackButtons(): HTMLElement[] {
  return screen.getAllByRole("button").filter((b) => b.title.includes(" · amount "));
}

describe("Replay", () => {
  it("defaults to PR-level granularity, showing only pr-kind revs as bars", () => {
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={vi.fn()} />);

    expect(trackButtons()).toHaveLength(1);
  });

  it("falls back to showing every rev when the repo has no pr-kind revs at all", () => {
    const revs: ReplayRev[] = [
      { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
      { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "Ada", author_kind: "human", amount: 0.5 },
    ];
    render(<Replay revs={revs} sha="bbb" onScrub={vi.fn()} />);

    expect(trackButtons()).toHaveLength(2);
  });

  it("toggling to commit-level shows every rev as a bar", () => {
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /commit/i }));

    expect(trackButtons()).toHaveLength(3);
  });

  it("bar title reflects amount and sha, and clicking scrubs to that rev", () => {
    const onScrub = vi.fn();
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={onScrub} />);

    const bars = trackButtons();
    expect(bars[0]!.title).toContain("bbb");
    expect(bars[0]!.title).toContain("amount 0.80");

    fireEvent.click(bars[0]!);
    expect(onScrub).toHaveBeenCalledWith("bbb");
  });

  it("scopes the track to the current sha's PR — branch point to head, not the whole repo history", () => {
    const revs: ReplayRev[] = [
      { sha: "other-head", kind: "pr", pr: 500, ts: "2026-01-06T00:00:00Z", author: "Cy", author_kind: "human", amount: 0.3 },
      { sha: "head", kind: "pr", pr: 412, ts: "2026-01-04T00:00:00Z", author: "Ada", author_kind: "human", amount: 0.6 },
      { sha: "mid", kind: "pr", pr: 412, ts: "2026-01-03T00:00:00Z", author: "agent", author_kind: "agent", amount: 0.5 },
      { sha: "start", kind: "pr", pr: 412, ts: "2026-01-02T00:00:00Z", author: "agent", author_kind: "agent", amount: 0.1 },
      { sha: "main1", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Bo", author_kind: "human", amount: 0 },
    ];
    render(<Replay revs={revs} sha="mid" onScrub={vi.fn()} />);

    const shas = trackButtons().map((b) => b.title.split(" · ")[0]);
    expect(shas.sort()).toEqual(["head", "mid", "start"]);
  });

  it("commit granularity still scopes to the current PR, not the whole repo history", () => {
    const revs: ReplayRev[] = [
      { sha: "other-pr-head", kind: "pr", pr: 500, ts: "2026-01-06T00:00:00Z", author: "Cy", author_kind: "human", amount: 0.3 },
      { sha: "head", kind: "pr", pr: 412, ts: "2026-01-04T00:00:00Z", author: "Ada", author_kind: "human", amount: 0.6 },
      { sha: "mid", kind: "commit", pr: 412, ts: "2026-01-03T00:00:00Z", author: "agent", author_kind: "agent", amount: 0.5 },
      { sha: "start", kind: "commit", pr: 412, ts: "2026-01-02T00:00:00Z", author: "agent", author_kind: "agent", amount: 0.1 },
      { sha: "main1", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Bo", author_kind: "human", amount: 0 },
    ];
    render(<Replay revs={revs} sha="mid" onScrub={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /commit/i }));

    const shas = trackButtons().map((b) => b.title.split(" · ")[0]);
    expect(shas.sort()).toEqual(["head", "mid", "start"]);
  });

  it("shows a short (7-char) sha caption under each bar, not the full hash, so the track is legible without hovering", () => {
    const revs: ReplayRev[] = [
      { sha: "1ba50aba87d149ff29d8e0ca2e6b1372cc9152a1", kind: "pr", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0.1 },
    ];
    render(<Replay revs={revs} sha={revs[0]!.sha} onScrub={vi.fn()} />);

    expect(screen.getByText("1ba50ab")).toBeInTheDocument();
    expect(screen.queryByText(revs[0]!.sha)).toBeNull();
  });

  it("shows the current rev's message and author below the track, like the mock's timeline readout", () => {
    const revs: ReplayRev[] = [
      { sha: "bbb", kind: "pr", message: "tune default rate limits", ts: "2026-01-02T00:00:00Z", author: "j.moreau", author_kind: "human", amount: 0.5 },
    ];
    render(<Replay revs={revs} sha="bbb" onScrub={vi.fn()} />);

    expect(screen.getByText("tune default rate limits")).toBeInTheDocument();
    expect(screen.getByText(/j\.moreau/)).toBeInTheDocument();
  });
});
