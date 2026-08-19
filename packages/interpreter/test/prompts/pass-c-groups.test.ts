import { describe, expect, it } from "vitest";
import { passCGroupsPrompt } from "../../src/prompts/pass-c-groups.js";
import type { ImportEdge } from "../../src/checker.js";

const layers = [{ name: "api", why: "Handles inbound HTTP requests." }];
const edges: ImportEdge[] = [];

describe("passCGroupsPrompt repo context", () => {
  it("omits the repo context section when none is given", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt).not.toContain("Repo context");
  });

  it("includes a repo context section when given", () => {
    const prompt = passCGroupsPrompt(layers, edges, "This repo exposes a public HTTP API.");

    expect(prompt).toContain("Repo context");
    expect(prompt).toContain("This repo exposes a public HTTP API.");
  });
});

describe("passCGroupsPrompt naming rules", () => {
  it("instructs reusing an existing directory or doc-derived name verbatim before inventing one", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt.toLowerCase()).toContain("reuse");
    expect(prompt.toLowerCase()).toContain("verbatim");
    expect(prompt.toLowerCase()).toContain("only invent a new");
  });

  it("does not steer naming toward generic invented examples like core domain/api surface/platform", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt).not.toContain('"api surface"');
    expect(prompt).not.toContain('"core domain"');
    expect(prompt).not.toContain('"platform"');
  });

  it("explicitly bans generic architecture-speak words from appearing inside a group name, including cluster", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    for (const banned of ["core", "domain", "cluster", "layer"]) {
      expect(prompt.toLowerCase()).toContain(banned);
    }
  });

  it("does not use cluster/group-flavored words as the example key in the response schema", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt).not.toContain('"group-name"');
    expect(prompt).not.toContain('"cluster-name"');
  });
});
