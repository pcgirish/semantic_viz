import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, type InitOptions, type ToolInfo } from "../src/init.js";

const NPM_TOOL: ToolInfo = { name: "semviz", version: "1.2.3", nodeMajor: "24", repoUrl: "https://github.com/example/semviz.git" };
const CHECKOUT_TOOL: ToolInfo = {
  ...NPM_TOOL,
  checkoutSha: "0123456789abcdef0123456789abcdef01234567",
  resolveRef: (ref) => (ref === "v1.2.3" ? "89abcdef0123456789abcdef0123456789abcdef" : undefined),
};

describe("runInit", () => {
  let root: string;
  let skillsDir: string;
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  const init = (options: Partial<InitOptions> = {}) => runInit({ root, skillsDir, tool: NPM_TOOL, ...options });
  const outcomeOf = (result: ReturnType<typeof runInit>, rel: string) => result.actions.find((a) => a.path === rel)?.outcome;

  beforeEach(() => {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), "scv-init-")));
    root = path.join(base, "repo");
    skillsDir = path.join(base, "skills");
    mkdirSync(root);
    for (const name of ["agent-analyze-repo", "agent-analyze-pr"]) {
      mkdirSync(path.join(skillsDir, name, "refs"), { recursive: true });
      writeFileSync(path.join(skillsDir, name, "SKILL.md"), `# ${name}\n`);
      writeFileSync(path.join(skillsDir, name, "refs", "notes.md"), `${name} notes\n`);
    }
  });
  afterEach(() => rmSync(path.dirname(root), { recursive: true, force: true }));

  it("sets up a fresh repo: skills, .claude/skills link, ignore rules, attributes, workflow and AGENTS.md", () => {
    const result = init();

    expect(read(".agents/skills/agent-analyze-pr/SKILL.md")).toBe("# agent-analyze-pr\n");
    expect(read(".agents/skills/agent-analyze-repo/refs/notes.md")).toBe("agent-analyze-repo notes\n");
    expect(lstatSync(path.join(root, ".claude/skills")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(root, ".claude/skills"))).toBe(path.join("..", ".agents", "skills"));
    expect(read(".claude/skills/agent-analyze-pr/SKILL.md")).toBe("# agent-analyze-pr\n");

    expect(read(".gitattributes")).toContain(".scv/semantics/** linguist-generated=true\n");
    expect(read("AGENTS.md")).toContain("Before opening a PR, run the `agent-analyze-pr` skill.");

    const workflow = read(".github/workflows/scv-check.yml");
    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("BASE_REF: ${{ github.base_ref }}");
    expect(workflow).toContain('npx --yes --package semviz@1.2.3 scv check --base "origin/$BASE_REF"');
    expect(workflow).not.toMatch(/run:.*\$\{\{/);

    expect(result.actions.every((a) => a.outcome === "created")).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.next).toContain("agent-analyze-repo");
    expect(result.next).toContain(".scv/semantics/");
  });

  it("writes ignore rules that leave only .scv/semantics/ commit-eligible", () => {
    init();
    spawnSync("git", ["init", "-q"], { cwd: root });
    const ignored = (file: string) => spawnSync("git", ["check-ignore", "-q", file], { cwd: root }).status === 0;
    expect(ignored(".scv/semantics/docs.json")).toBe(false);
    expect(ignored(".scv/semantics/functions/src%2Fa.py.json")).toBe(false);
    for (const local of ["cache.sqlite", "cache.sqlite-wal", "artifacts/x.json", "snapshots/s.json", "deltas/d.json", "layouts/l.json", "pending/p.json", "config.yaml", ".semantics-staging/docs.json", ".semantics-old/docs.json"]) {
      expect(ignored(`.scv/${local}`), local).toBe(true);
    }
  });

  it("is idempotent: a second run changes nothing", () => {
    init();
    const files = [".gitignore", ".gitattributes", "AGENTS.md", ".github/workflows/scv-check.yml", ".agents/skills/agent-analyze-pr/SKILL.md"];
    const before = files.map(read);

    const again = init();

    expect(files.map(read)).toEqual(before);
    expect(again.actions.length).toBeGreaterThan(0);
    expect(again.actions.every((a) => a.outcome === "unchanged")).toBe(true);
  });

  it("keeps existing user content and appends only what is missing", () => {
    write(".gitignore", "node_modules/\n.scv/artifacts/");
    write(".gitattributes", "*.png binary\n");
    write("AGENTS.md", "# Agents\n\nUse tabs.\n");

    const result = init();

    const gitignore = read(".gitignore");
    expect(gitignore.startsWith("node_modules/\n.scv/artifacts/\n")).toBe(true);
    expect(gitignore.match(/^\.scv\/artifacts\/$/gm)).toHaveLength(1);
    expect(gitignore).toContain(".scv/cache.sqlite\n");
    expect(read(".gitattributes")).toBe("*.png binary\n\n.scv/semantics/** linguist-generated=true\n");
    expect(read("AGENTS.md").startsWith("# Agents\n\nUse tabs.\n\n")).toBe(true);
    for (const rel of [".gitignore", ".gitattributes", "AGENTS.md"]) expect(outcomeOf(result, rel)).toBe("updated");
  });

  it("never overwrites a user-modified skill file or workflow, and reports them as kept", () => {
    write(".agents/skills/agent-analyze-pr/SKILL.md", "# my local edits\n");
    write(".github/workflows/scv-check.yml", "name: mine\n");

    const result = init();

    expect(read(".agents/skills/agent-analyze-pr/SKILL.md")).toBe("# my local edits\n");
    expect(read(".github/workflows/scv-check.yml")).toBe("name: mine\n");
    expect(read(".agents/skills/agent-analyze-repo/SKILL.md")).toBe("# agent-analyze-repo\n");
    expect(outcomeOf(result, ".agents/skills/agent-analyze-pr/SKILL.md")).toBe("kept");
    expect(outcomeOf(result, ".github/workflows/scv-check.yml")).toBe("kept");
  });

  it("never writes through a dangling symlink at a path it owns", () => {
    const outside = path.join(path.dirname(root), "outside.yml");
    mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
    symlinkSync(outside, path.join(root, ".github/workflows/scv-check.yml"));

    const result = init();

    expect(existsSync(outside)).toBe(false);
    expect(outcomeOf(result, ".github/workflows/scv-check.yml")).toBe("kept");
  });

  it("never writes outside the repo through a symlinked directory or shared file", () => {
    const outside = path.join(path.dirname(root), "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "AGENTS.md"), "# theirs\n");
    symlinkSync(outside, path.join(root, ".github"));
    symlinkSync(path.join(outside, "AGENTS.md"), path.join(root, "AGENTS.md"));

    const result = init();

    expect(existsSync(path.join(outside, "workflows"))).toBe(false);
    expect(readFileSync(path.join(outside, "AGENTS.md"), "utf-8")).toBe("# theirs\n");
    expect(outcomeOf(result, ".github/workflows/scv-check.yml")).toBe("kept");
    expect(outcomeOf(result, "AGENTS.md")).toBe("kept");
    expect(result.warnings.join("\n")).toMatch(/AGENTS\.md.*outside the repo/);
  });

  it("follows a symlinked shared file that stays inside the repo", () => {
    write("CLAUDE.md", "# Agents\n");
    symlinkSync("CLAUDE.md", path.join(root, "AGENTS.md"));

    expect(outcomeOf(init(), "AGENTS.md")).toBe("updated");
    expect(read("CLAUDE.md")).toContain("agent-analyze-pr");
  });

  it("keeps a directory sitting where an init-owned file goes", () => {
    mkdirSync(path.join(root, ".github/workflows/scv-check.yml"), { recursive: true });
    expect(outcomeOf(init(), ".github/workflows/scv-check.yml")).toBe("kept");
  });

  it("leaves an existing .claude/skills alone", () => {
    write(".claude/skills/mine/SKILL.md", "# mine\n");

    const result = init();

    expect(lstatSync(path.join(root, ".claude/skills")).isDirectory()).toBe(true);
    expect(existsSync(path.join(root, ".claude/skills/agent-analyze-pr"))).toBe(false);
    expect(outcomeOf(result, ".claude/skills")).toBe("kept");
  });

  it("warns when .scv/ is ignored as a whole, since the store could not be committed", () => {
    write(".gitignore", ".scv/\n");
    expect(init().warnings.join("\n")).toMatch(/\.scv\/.*ignored.*\.scv\/semantics\//);
  });

  it("installs from git, pinned to the checkout that ran init, when run from a semviz clone", () => {
    init({ tool: CHECKOUT_TOOL });
    const workflow = read(".github/workflows/scv-check.yml");
    expect(workflow).toContain(`SCV_REF: "${CHECKOUT_TOOL.checkoutSha}"`);
    expect(workflow).toContain(`SCV_REPO: "${CHECKOUT_TOOL.repoUrl}"`);
    expect(workflow).toContain('git -C "$RUNNER_TEMP/semviz" fetch --depth 1 origin "$SCV_REF"');
    expect(workflow).toContain('node "$RUNNER_TEMP/semviz/packages/cli/dist/bin.js" check --base "origin/$BASE_REF"');
    expect(workflow).not.toContain("npx");
  });

  it("honors an explicit install method and git ref", () => {
    init({ tool: CHECKOUT_TOOL, install: "npm" });
    expect(read(".github/workflows/scv-check.yml")).toContain("npx --yes --package semviz@1.2.3");

    rmSync(path.join(root, ".github"), { recursive: true });
    const sha = "fedcba9876543210fedcba9876543210fedcba98";
    init({ install: "git", gitRef: sha });
    expect(read(".github/workflows/scv-check.yml")).toContain(`SCV_REF: "${sha}"`);
  });

  it("pins a branch or tag to the commit it names in the scv checkout, never the movable ref", () => {
    init({ tool: CHECKOUT_TOOL, gitRef: "v1.2.3" });
    const workflow = read(".github/workflows/scv-check.yml");
    expect(workflow).toContain('SCV_REF: "89abcdef0123456789abcdef0123456789abcdef"');
    expect(workflow).not.toContain("v1.2.3\"");
  });

  it("rejects a branch or tag it cannot resolve to a commit", () => {
    expect(() => init({ install: "git", gitRef: "v1.2.3" })).toThrow(/--git-ref.*commit sha/);
    expect(() => init({ tool: CHECKOUT_TOOL, gitRef: "no-such-tag" })).toThrow(/--git-ref/);
    expect(existsSync(path.join(root, ".agents"))).toBe(false);
  });

  it("rejects a git install with no ref to pin, an unsafe ref, and a missing root", () => {
    expect(() => init({ install: "git" })).toThrow(/--git-ref/);
    expect(() => init({ install: "git", gitRef: "main; rm -rf /" })).toThrow(/--git-ref/);
    expect(() => init({ install: "pip" as InitOptions["install"] })).toThrow(/--install/);
    expect(() => init({ root: path.join(root, "nope") })).toThrow(/not a directory/);
    expect(existsSync(path.join(root, ".agents"))).toBe(false);
  });

  it("fails when the package has no bundled skills", () => {
    expect(() => init({ skillsDir: path.join(root, "missing") })).toThrow(/no bundled agent-analyze-\* skills/);
  });
});
