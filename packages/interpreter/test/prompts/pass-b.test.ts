import { describe, expect, it } from "vitest";
import { passBPrompt } from "../../src/prompts/pass-b.js";
import type { ImportEdge } from "../../src/checker.js";

const files = ["src/admin_tasks.py", "scripts/backfill.py", "src/api/routes.py", "src/api/middleware/rate_limiter.py"];
const oneLiners: Record<string, string> = {
  "src/admin_tasks.py": "Runs admin-only maintenance jobs.",
  "scripts/backfill.py": "One-off backfill script.",
  "src/api/routes.py": "Public API route handlers.",
  "src/api/middleware/rate_limiter.py": "Token-bucket rate limiter middleware.",
};
const edges: ImportEdge[] = [
  { from: "src/admin_tasks.py", to: "scripts/backfill.py", weight: 1 },
  { from: "src/api/routes.py", to: "src/api/middleware/rate_limiter.py", weight: 1 },
];

describe("passBPrompt merge-based design", () => {
  it("includes a base partition section showing directories and their files", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt).toContain("Base directories");
    expect(prompt).toContain("src");
    expect(prompt).toContain("scripts");
  });

  it("asks the LLM to propose merges of base directories, not to freely partition all files", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt.toLowerCase()).toContain("merge");
    expect(prompt.toLowerCase()).toContain("directory");
    expect(prompt.toLowerCase()).toContain("propose");
  });

  it("shows directory dependency edges in the prompt", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt.toLowerCase()).toContain("directory");
    expect(prompt.toLowerCase()).toContain("depend");
  });

  it("specifies that omitted directories implicitly stay as singleton clusters", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt.toLowerCase()).toContain("omit");
    expect(prompt.toLowerCase()).toContain("singleton");
  });

  it("expects a response shape with 'merges' not 'clusters'", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt).toContain('"merges"');
    expect(prompt).not.toContain('"clusters"');
  });
});

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
});

describe("passBPrompt naming rules", () => {
  it("instructs reusing an existing directory or doc-derived name verbatim before inventing one", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt).toContain("reuse");
    expect(prompt).toContain("verbatim");
    expect(prompt.toLowerCase()).toContain("only invent a new");
  });

  it("explicitly bans generic architecture-speak words from appearing inside a group name", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    for (const banned of ["core", "domain", "cluster", "layer", "module", "component"]) {
      expect(prompt.toLowerCase()).toContain(banned);
    }
  });

  it("instructs not to name a group the same as one of its member directories", () => {
    const prompt = passBPrompt(files, oneLiners, edges);

    expect(prompt.toLowerCase()).toContain("identical");
    expect(prompt.toLowerCase()).toContain("member");
  });
});
