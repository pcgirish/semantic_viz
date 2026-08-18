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
