import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Unit } from "@semviz/schema";
import { UnitSearch } from "../src/UnitSearch.js";

afterEach(cleanup);

function unit(id: string, name: string, kind: Unit["kind"] = "module"): Unit {
  return {
    id,
    kind,
    name,
    qualname: name,
    children: [],
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: {},
    provenance: { source: "static" },
  };
}

const units = [
  unit("u:layer:db", "database", "layer"),
  unit("u:a", "connection.ts"),
  unit("u:b", "connection_pool.ts"),
  unit("u:c", "router.ts"),
];

describe("UnitSearch", () => {
  it("offers nothing until something is typed, so it costs no screen space idle", () => {
    render(<UnitSearch units={units} onPick={vi.fn()} />);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("matches on a substring anywhere in the name, not just a prefix", () => {
    // A search that only matched prefixes would be useless against path-like module names,
    // which is exactly the deep-hierarchy case this exists for.
    render(<UnitSearch units={units} onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pool" } });
    expect(screen.getByRole("option", { name: /connection_pool/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^router/ })).toBeNull();
  });

  it("ignores case, since nobody types a filename's capitalisation from memory", () => {
    render(<UnitSearch units={units} onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ROUTER" } });
    expect(screen.getByRole("option", { name: /router/ })).toBeInTheDocument();
  });

  it("hands back the unit id, which is what focusing needs", () => {
    const onPick = vi.fn();
    render(<UnitSearch units={units} onPick={onPick} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "router" } });
    fireEvent.click(screen.getByRole("option", { name: /router/ }));
    expect(onPick).toHaveBeenCalledWith("u:c");
  });

  it("clears itself after a pick, so the results do not sit over the canvas", () => {
    render(<UnitSearch units={units} onPick={vi.fn()} />);
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "router" } });
    fireEvent.click(screen.getByRole("option", { name: /router/ }));
    expect(box.value).toBe("");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("caps the list, so a common substring cannot paper over the whole window", () => {
    const many = Array.from({ length: 40 }, (_, i) => unit(`u:${i}`, `handler_${i}.ts`));
    render(<UnitSearch units={many} onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "handler" } });
    expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(10);
  });

  it("says so when nothing matches, rather than looking broken", () => {
    render(<UnitSearch units={units} onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });
});
