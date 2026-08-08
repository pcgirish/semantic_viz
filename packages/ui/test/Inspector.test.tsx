import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Edge, External, Unit } from "@scv/schema";
import { Inspector } from "../src/Inspector.js";

function makeExternal(overrides: Partial<External> & { id: string; name: string }): External {
  return {
    ecosystem: "pypi",
    version: "1.0.0",
    direct: true,
    depth: 1,
    reached_by: [],
    transitive_count: null,
    ...overrides,
  };
}

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "function",
    name: overrides.id,
    qualname: `pkg.${overrides.id}`,
    parent: null,
    children: [],
    loc: { files: ["src/a.ts"], sloc: 12 },
    tags: [],
    metrics: { sloc: 12, fan_in: 1, fan_out: 2 },
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

describe("Inspector", () => {
  afterEach(() => cleanup());

  it("renders an empty state carrying information, not a blank tray, when nothing is selected", () => {
    render(<Inspector unit={null} units={[]} edges={[]} />);
    expect(screen.getByText(/nothing selected/i)).toBeInTheDocument();
  });

  it("renders name, id, kind, and file for the selected unit", () => {
    const unit = makeUnit({ id: "u:check", name: "check", kind: "function", loc: { files: ["src/api/rl.py"], sloc: 5 } });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText("check")).toBeInTheDocument();
    expect(screen.getByText("u:check")).toBeInTheDocument();
    expect(screen.getByText(/function/i)).toBeInTheDocument();
    expect(screen.getByText("src/api/rl.py")).toBeInTheDocument();
  });

  it("renders tags", () => {
    const unit = makeUnit({ id: "check", tags: ["hot-path", "no-fallback"] });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText("hot-path")).toBeInTheDocument();
    expect(screen.getByText("no-fallback")).toBeInTheDocument();
  });

  it("renders signature in/out/raises when present", () => {
    const unit = makeUnit({
      id: "check",
      signature: {
        in: [{ name: "user_id", type: "str", nullable: false }],
        out: [{ name: "return", type: "bool", nullable: false }],
        raises: ["RateLimitExceeded"],
        async: true,
      },
    });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText(/user_id/)).toBeInTheDocument();
    expect(screen.getByText(/RateLimitExceeded/)).toBeInTheDocument();
  });

  it("shows an explicit 'not yet available' state for semantics (what/how/when/where/why) when null, not blank fields", () => {
    const unit = makeUnit({ id: "check", semantics: null });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText(/no interpreter pass has run/i)).toBeInTheDocument();
  });

  it("renders semantics fields when present, with confidence", () => {
    const unit = makeUnit({
      id: "check",
      semantics: {
        what: "Rate limits a request",
        how: "Redis token bucket",
        when: "Every request",
        where: "middleware",
        why: "Prevent abuse",
        confidence: 0.86,
        source: "llm",
      },
    });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText("Rate limits a request")).toBeInTheDocument();
    expect(screen.getByText(/86%/)).toBeInTheDocument();
  });

  it("shows a header confidence badge alongside the semantics confidence readout", () => {
    const unit = makeUnit({
      id: "check",
      semantics: { what: "w", how: "h", when: "wh", where: "wr", why: "y", confidence: 0.93, source: "llm" },
    });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText("conf 0.93")).toBeInTheDocument();
  });

  it("shows authors as badges, dominant contributor (most lines) first", () => {
    const unit = makeUnit({
      id: "check",
      authors: [
        { name: "agent", lines: 4 },
        { name: "Ada", lines: 40 },
      ],
    });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    const ada = screen.getByText("Ada");
    const agent = screen.getByText("agent");
    expect(ada.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("visually distinguishes low-confidence semantics (< 0.6) from high-confidence", () => {
    const lowUnit = makeUnit({
      id: "low",
      semantics: { what: "w", how: "h", when: "wh", where: "wr", why: "y", confidence: 0.4, source: "llm" },
    });
    const { container } = render(<Inspector unit={lowUnit} units={[lowUnit]} edges={[]} />);
    expect(container.querySelector(".low-confidence")).not.toBeNull();
  });

  it("renders metrics (sloc, fan_in, fan_out)", () => {
    const unit = makeUnit({ id: "check", metrics: { sloc: 12, fan_in: 3, fan_out: 4, churn: 7 } });
    render(<Inspector unit={unit} units={[unit]} edges={[]} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders depends-on (outgoing) and used-by (incoming) from edges", () => {
    const a = makeUnit({ id: "a" });
    const b = makeUnit({ id: "b" });
    const c = makeUnit({ id: "c" });
    const edges: Edge[] = [
      { id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "c", to: "a", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    render(<Inspector unit={a} units={[a, b, c]} edges={edges} />);
    expect(screen.getByText("b")).toBeInTheDocument(); // depends on
    expect(screen.getByText("c")).toBeInTheDocument(); // used by
  });

  it("empty dependents reads as information, not apology, per serve.md's empty-state rule", () => {
    const a = makeUnit({ id: "a" });
    render(<Inspector unit={a} units={[a]} edges={[]} />);
    expect(screen.getByText(/nothing\. removing this is free/i)).toBeInTheDocument();
  });

  it("renders an external's name, ecosystem, and depth/direct tags when an external is selected", () => {
    const redis = makeExternal({ id: "x:pypi:redis@5.0.1", name: "redis", ecosystem: "pypi", version: "5.0.1", depth: 1, direct: true });
    const { container } = render(<Inspector unit={null} units={[]} edges={[]} external={redis} />);

    expect(screen.getByText("redis")).toBeInTheDocument();
    expect(container.querySelector(".meta")!.textContent).toMatch(/pypi/i);
    expect(screen.getByText(/depth 1/i)).toBeInTheDocument();
    expect(screen.getByText(/^direct$/i)).toBeInTheDocument();
  });

  it("lists every unit that reaches the selected external and why it's present", () => {
    const limiter = makeUnit({ id: "u:limiter", name: "rate_limiter" });
    const redis = makeExternal({ id: "x:pypi:redis@5.0.1", name: "redis", reached_by: ["u:limiter"] });
    render(<Inspector unit={null} units={[limiter]} edges={[]} external={redis} />);

    expect(screen.getByText("rate_limiter")).toBeInTheDocument();
  });

  it("shows transitive_count as 'not computed' rather than 0 when it is null, per serve.md's honesty rule", () => {
    const pkg = makeExternal({ id: "x:pypi:fastapi@1", name: "fastapi", transitive_count: null });
    render(<Inspector unit={null} units={[]} edges={[]} external={pkg} />);

    expect(screen.getByText(/not computed/i)).toBeInTheDocument();
  });

  it("prefers the external tray over the unit tray when both are provided", () => {
    const unit = makeUnit({ id: "u:check" });
    const redis = makeExternal({ id: "x:pypi:redis@5.0.1", name: "redis" });
    render(<Inspector unit={unit} units={[unit]} edges={[]} external={redis} />);

    expect(screen.getByText("redis")).toBeInTheDocument();
    expect(screen.queryByText("u:check")).not.toBeInTheDocument();
  });
});
