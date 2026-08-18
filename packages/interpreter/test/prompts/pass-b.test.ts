import { describe, expect, it } from "vitest";
import { passBPrompt } from "../../src/prompts/pass-b.js";
import type { ImportEdge } from "../../src/checker.js";

const files = ["src/admin_tasks.py", "scripts/backfill.py"];
const oneLiners: Record<string, string> = {
  "src/admin_tasks.py": "Runs admin-only maintenance jobs.",
  "scripts/backfill.py": "One-off backfill script.",
};
const edges: ImportEdge[] = [{ from: "src/admin_tasks.py", to: "scripts/backfill.py", weight: 1 }];

describe("passBPrompt repo context", () => {
  it("omits the repo context section when none is given", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt).not.toContain("Repo context");
  });

  it("includes a repo context section when given", () => {
    const prompt = passBPrompt(files, oneLiners, edges, "## Docs\nThis repo is an order service.");

    expect(prompt).toContain("Repo context");
    expect(prompt).toContain("This repo is an order service.");
  });

  it("places the repo context section before Rules", () => {
    const prompt = passBPrompt(files, oneLiners, edges, "Some repo context.");

    expect(prompt.indexOf("Repo context")).toBeLessThan(prompt.indexOf("Rules:"));
  });
});

describe("passBPrompt naming rules", () => {
  it("instructs reusing an existing directory or doc-derived name verbatim before inventing one", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt).toContain("reuse");
    expect(prompt).toContain("verbatim");
    expect(prompt.toLowerCase()).toContain("only invent a new");
  });

  it("does not steer naming toward generic invented examples like ops/api/orders", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt).not.toContain('"ops"');
    expect(prompt).not.toContain('"orders"');
  });
});

describe("passBPrompt target cluster count", () => {
  it("suggests a target cluster count derived from file count", () => {
    const manyFiles = Array.from({ length: 16 }, (_, i) => `src/file${i}.py`);
    const prompt = passBPrompt(manyFiles, {}, []);

    // sqrt(16) = 4
    expect(prompt).toContain("4 clusters");
  });

  it("clamps the target cluster count to a minimum of 2", () => {
    const fewFiles = ["src/a.py", "src/b.py"];
    const prompt = passBPrompt(fewFiles, {}, []);

    expect(prompt).toContain("2 clusters");
  });

  it("clamps the target cluster count to a maximum of 12", () => {
    const manyFiles = Array.from({ length: 400 }, (_, i) => `src/file${i}.py`);
    const prompt = passBPrompt(manyFiles, {}, []);

    expect(prompt).toContain("12 clusters");
  });
});
