import { describe, expect, it } from "vitest";
import { passCPrompt } from "../../src/prompts/pass-c.js";

const files = ["src/api/routes.py"];
const oneLiners: Record<string, string> = { "src/api/routes.py": "Public API route handlers." };

describe("passCPrompt repo context", () => {
  it("omits the repo context section when none is given", () => {
    const prompt = passCPrompt("api", files, oneLiners);

    expect(prompt).not.toContain("Repo context");
  });

  it("includes a repo context section when given", () => {
    const prompt = passCPrompt("api", files, oneLiners, "This repo exposes a public HTTP API.");

    expect(prompt).toContain("Repo context");
    expect(prompt).toContain("This repo exposes a public HTTP API.");
  });
});
