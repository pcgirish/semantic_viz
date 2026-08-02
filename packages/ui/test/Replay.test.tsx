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

describe("Replay", () => {
  it("defaults to PR-level granularity, showing only pr-kind revs as bars", () => {
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={vi.fn()} />);

    expect(screen.getAllByTestId("replay-bar")).toHaveLength(1);
  });

  it("falls back to showing every rev when the repo has no pr-kind revs at all", () => {
    const revs: ReplayRev[] = [
      { sha: "aaa", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
      { sha: "bbb", kind: "commit", ts: "2026-01-02T00:00:00Z", author: "Ada", author_kind: "human", amount: 0.5 },
    ];
    render(<Replay revs={revs} sha="bbb" onScrub={vi.fn()} />);

    expect(screen.getAllByTestId("replay-bar")).toHaveLength(2);
  });

  it("toggling to commit-level shows every rev as a bar", () => {
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /commit/i }));

    expect(screen.getAllByTestId("replay-bar")).toHaveLength(3);
  });

  it("bar height reflects amount and author_kind sets a distinct class", () => {
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={vi.fn()} />);

    const bars = screen.getAllByTestId("replay-bar");
    expect(bars[0].style.getPropertyValue("--amount")).toBe("0.8");
    expect(bars[0].classList.contains("author-agent")).toBe(true);
  });

  it("clicking a bar scrubs to that rev's sha", () => {
    const onScrub = vi.fn();
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={onScrub} />);

    fireEvent.click(screen.getAllByTestId("replay-bar")[0]);

    expect(onScrub).toHaveBeenCalledWith("bbb");
  });

  it("marks the currently selected rev's bar as active", () => {
    render(<Replay revs={makeRevs()} sha="bbb" onScrub={vi.fn()} />);

    expect(screen.getAllByTestId("replay-bar")[0].classList.contains("active")).toBe(true);
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

    const shas = screen.getAllByTestId("replay-bar").map((b) => b.title.split(" · ")[0]);
    expect(shas.sort()).toEqual(["head", "mid", "start"]);
  });
});
