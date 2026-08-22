import { describe, expect, it } from "vitest";
import { passCPrompt } from "../../src/prompts/pass-c.js";

const files = ["src/api/routes.py"];
const oneLiners: Record<string, string> = { "src/api/routes.py": "Public API route handlers." };
const layerId = "u:layer:0123456789ab";

describe("passCPrompt repo context", () => {
  it("omits the repo context section when none is given", () => {
    const prompt = passCPrompt({ layerId, files, oneLiners });

    expect(prompt).not.toContain("Repo context");
  });

  it("includes a repo context section when given", () => {
    const prompt = passCPrompt({ layerId, files, oneLiners, repoContext: "This repo exposes a public HTTP API." });

    expect(prompt).toContain("Repo context");
    expect(prompt).toContain("This repo exposes a public HTTP API.");
  });
});

describe("passCPrompt naming", () => {
  it("describes the cluster by its members and never shows the layerId", () => {
    // The id is a sha1 hex slice — a map key on our side. Substituting it into the prompt where
    // a name used to go would poison the very naming output this pass now asks for.
    const prompt = passCPrompt({ layerId, files, oneLiners });

    expect(prompt).toContain("src/api/routes.py");
    expect(prompt).toContain("Public API route handlers.");
    expect(prompt).not.toContain(layerId);
    expect(prompt).not.toContain("0123456789ab");
  });

  it("asks for a name as the first response field", () => {
    const prompt = passCPrompt({ layerId, files, oneLiners });

    expect(prompt).toContain('"name"');
    expect(prompt.indexOf('"name"')).toBeLessThan(prompt.indexOf('"what"'));
  });

  it("states the naming rules the normalizer enforces", () => {
    const prompt = passCPrompt({ layerId, files, oneLiners });

    expect(prompt).toMatch(/lowercase/i);
    expect(prompt).toMatch(/40/);
    expect(prompt).toMatch(/layer/);
  });
});
