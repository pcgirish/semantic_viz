import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Breadcrumb } from "../src/Breadcrumb.js";
import type { Unit } from "@scv/schema";

afterEach(cleanup);

function makeUnit(id: string, name: string): Unit {
  return {
    id,
    kind: "layer",
    name,
    qualname: name,
    lang: "python",
    parent: null,
    children: [],
    loc: { files: [], start: 0, end: 0, sloc: 0 },
    signature: { in: [], out: [], raises: [], async: false },
    semantics: null,
    cost: null,
    tags: [],
    metrics: { sloc: 0, fan_in: 0, fan_out: 0, churn: 0, commits: 0 },
    authors: [],
    hash: { struct: "", text: "", semantic: "" },
    provenance: { source: "static", pass: "A" },
  } as unknown as Unit;
}

describe("Breadcrumb", () => {
  it("renders nothing at root (no focus)", () => {
    const { container } = render(
      <Breadcrumb focus={null} focusStack={[]} units={[]} onGoTo={vi.fn()} onBack={vi.fn()} />,
    );
    expect(container.querySelector("#crumb")).toBeNull();
  });

  it("renders one segment per focusStack + focus entry, resolved to unit names", () => {
    const units = [makeUnit("u:a", "root"), makeUnit("u:b", "cli-tools"), makeUnit("u:c", "cli-commands")];
    render(<Breadcrumb focus="u:c" focusStack={["u:a", "u:b"]} units={units} onGoTo={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("cli-tools")).toBeInTheDocument();
    expect(screen.getByText("cli-commands")).toBeInTheDocument();
  });

  it("clicking a non-last segment calls onGoTo with its index", () => {
    const units = [makeUnit("u:a", "root"), makeUnit("u:b", "cli-tools"), makeUnit("u:c", "cli-commands")];
    const onGoTo = vi.fn();
    render(<Breadcrumb focus="u:c" focusStack={["u:a", "u:b"]} units={units} onGoTo={onGoTo} onBack={vi.fn()} />);

    fireEvent.click(screen.getByText("cli-tools"));

    expect(onGoTo).toHaveBeenCalledWith(1);
  });

  it("the last segment is not a clickable button", () => {
    const units = [makeUnit("u:a", "root"), makeUnit("u:c", "cli-commands")];
    render(<Breadcrumb focus="u:c" focusStack={["u:a"]} units={units} onGoTo={vi.fn()} onBack={vi.fn()} />);

    const last = screen.getByText("cli-commands");
    expect(last.tagName).not.toBe("BUTTON");
  });

  it("shows a back button that calls onBack when not at root", () => {
    const units = [makeUnit("u:a", "root"), makeUnit("u:b", "cli-tools")];
    const onBack = vi.fn();
    render(<Breadcrumb focus="u:b" focusStack={["u:a"]} units={units} onGoTo={vi.fn()} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });

  it("shows the back button one level in, even though focusStack is still empty there", () => {
    // drill() from root leaves focusStack === [] (only focus becomes non-null) — the back
    // button must key off focus, not focusStack.length, or it stays hidden on the first drill.
    const units = [makeUnit("u:a", "cli-tools")];
    render(<Breadcrumb focus="u:a" focusStack={[]} units={units} onGoTo={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("hides the back button at true root (no focus)", () => {
    render(<Breadcrumb focus={null} focusStack={[]} units={[]} onGoTo={vi.fn()} onBack={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
  });
});
