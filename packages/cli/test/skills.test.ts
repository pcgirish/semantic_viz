import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillsDir = fileURLToPath(new URL("../../../.agents/skills", import.meta.url));
const analyzeSkills = readdirSync(skillsDir).filter((name) => name.startsWith("agent-analyze-"));
const body = (name: string) => readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf-8");

// The agent-analyze skills are meant to run against any repo, so they describe behavior rather than cite this monorepo's source.
describe("agent-analyze skills", () => {
  it.each(analyzeSkills)("%s cites no monorepo source path", (name) => {
    expect(body(name)).not.toMatch(/packages\/\w+\/src\//);
  });

  it.each(analyzeSkills)("%s has frontmatter naming its directory", (name) => {
    expect(body(name)).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: \\S.*\\n---\\n`));
  });

  it("ships agent-analyze-pr", () => {
    expect(existsSync(path.join(skillsDir, "agent-analyze-pr", "SKILL.md"))).toBe(true);
  });

  it("ends the full bootstrap and the incremental run by exporting the committed store", () => {
    expect(body("agent-analyze-repo")).toContain("scv export");
    expect(body("agent-analyze-pr")).toMatch(/scv check --base/);
  });
});
