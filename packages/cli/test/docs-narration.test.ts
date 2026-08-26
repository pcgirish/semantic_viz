import { describe, expect, it } from "vitest";
import { classifyDocsNarration } from "../src/docs-narration.js";

describe("classifyDocsNarration", () => {
  it("continues when the repo genuinely has no docs", () => {
    const result = classifyDocsNarration({ discoveredPaths: [], docs: [] });
    expect(result.status).toBe("none-discovered");
    expect(result.halt).toBe(false);
    expect(result.missingPaths).toEqual([]);
  });

  it("halts when docs were discovered but the artifact is absent", () => {
    const result = classifyDocsNarration({ discoveredPaths: ["README.md"], docs: undefined });
    expect(result.status).toBe("absent");
    expect(result.halt).toBe(true);
    expect(result.missingPaths).toEqual(["README.md"]);
  });

  // A `--no-llm` default and a failed merge both land here; both mean the discovered docs were
  // dropped, which is the poor-clustering input the check exists to catch.
  it("halts when discovered docs were dropped to an empty artifact", () => {
    const result = classifyDocsNarration({ discoveredPaths: ["README.md", "docs/api.md"], docs: [] });
    expect(result.status).toBe("defaulted");
    expect(result.halt).toBe(true);
    expect(result.missingPaths).toEqual(["README.md", "docs/api.md"]);
  });

  it("warns but continues on partial coverage, naming the missing paths", () => {
    const result = classifyDocsNarration({
      discoveredPaths: ["README.md", "docs/api.md", "docs/ops.md"],
      docs: [{ path: "README.md" }],
    });
    expect(result.status).toBe("partial");
    expect(result.halt).toBe(false);
    expect(result.missingPaths).toEqual(["docs/api.md", "docs/ops.md"]);
  });

  it("reports full narration when every discovered doc has an extract", () => {
    const result = classifyDocsNarration({
      discoveredPaths: ["README.md", "docs/api.md"],
      docs: [{ path: "docs/api.md" }, { path: "README.md" }],
    });
    expect(result.status).toBe("narrated");
    expect(result.halt).toBe(false);
    expect(result.missingPaths).toEqual([]);
  });
});
