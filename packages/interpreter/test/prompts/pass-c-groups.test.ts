import { describe, expect, it } from "vitest";
import { passCGroupsPrompt } from "../../src/prompts/pass-c-groups.js";
import type { ImportEdge } from "../../src/checker.js";

const layers = [
  { name: "ops", why: "Groups operational scripts that run outside the request path." },
  { name: "api", why: "Handles all public-facing HTTP traffic." },
  { name: "db", why: "Database schema and migrations." },
];
const edges: ImportEdge[] = [];

describe("passCGroupsPrompt merge-based design", () => {
  it("includes a base partition section showing layer names", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt).toContain("Base layers");
    expect(prompt).toContain("ops");
    expect(prompt).toContain("api");
    expect(prompt).toContain("db");
  });

  it("asks the LLM to propose merges of base layers, not to freely partition all layers", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt.toLowerCase()).toContain("merge");
    expect(prompt.toLowerCase()).toContain("layer");
  });

  it("specifies that omitted layers implicitly stay as singleton groups", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt.toLowerCase()).toContain("omit");
    expect(prompt.toLowerCase()).toContain("singleton");
  });

  it("expects a response shape with 'merges' not 'groups'", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt).toContain('"merges"');
    expect(prompt).not.toContain('"groups"');
  });
});

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

  it("explicitly bans generic architecture-speak words from appearing inside a group name", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    for (const banned of ["core", "domain", "cluster", "layer", "module", "component"]) {
      expect(prompt.toLowerCase()).toContain(banned);
    }
  });

  it("instructs not to name a group the same as one of its member layers", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt.toLowerCase()).toContain("identical");
    expect(prompt.toLowerCase()).toContain("member");
  });
});

describe("passCGroupsPrompt degenerate-output guardrails", () => {
  it("discourages merging every layer into a single group", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt.toLowerCase()).toContain("do not merge every layer into a single group");
  });

  it("discourages leaving every layer unmerged when a plausible merge exists", () => {
    const prompt = passCGroupsPrompt(layers, edges);

    expect(prompt.toLowerCase()).toContain("an empty merges map is only correct if no two layers are meaningfully related");
  });
});
