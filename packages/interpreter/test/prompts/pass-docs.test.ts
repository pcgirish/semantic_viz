import { describe, expect, it } from "vitest";
import { passDocsPrompt } from "../../src/prompts/pass-docs.js";

describe("passDocsPrompt", () => {
  it("includes the doc path and content", () => {
    const prompt = passDocsPrompt("README.md", "# My Project\n\nA thing that does stuff.");

    expect(prompt).toContain("README.md");
    expect(prompt).toContain("A thing that does stuff.");
  });

  it("asks for purpose/modules/architecture_notes JSON shape", () => {
    const prompt = passDocsPrompt("docs/design.md", "Some design doc content.");

    expect(prompt).toContain('"purpose"');
    expect(prompt).toContain('"modules"');
    expect(prompt).toContain('"architecture_notes"');
    expect(prompt).toContain('"paths"');
  });

  it("instructs that a doc with no structural content should return empty arrays, not an error", () => {
    const prompt = passDocsPrompt("CONTRIBUTING.md", "Please run npm test before submitting a PR.");

    expect(prompt.toLowerCase()).toContain("empty");
  });
});
