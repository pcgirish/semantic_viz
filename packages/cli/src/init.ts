import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { git } from "./checkout.js";

/** What `init` needs to know about the scv package running it. */
export interface ToolInfo {
  /** npm package name. */
  name: string;
  version: string;
  /** Node major version CI should run, from the package's `engines.node`. */
  nodeMajor: string;
  /** HTTPS clone URL of the scv source repo. */
  repoUrl: string;
  /** HEAD of the scv source checkout this CLI runs from; absent for an npm install. */
  checkoutSha?: string;
}

export type InstallMethod = "npm" | "git";

export interface InitOptions {
  root: string;
  /** How the CI workflow installs scv. Defaults to `git` when run from a source checkout, else `npm`. */
  install?: InstallMethod;
  /** Commit-ish CI builds scv from with `install: "git"`. Defaults to the checkout's HEAD. */
  gitRef?: string;
  /** Overrides the bundled skills directory (tests). */
  skillsDir?: string;
  /** Overrides the running package's info (tests). */
  tool?: ToolInfo;
}

/** created: written fresh · updated: missing lines appended · unchanged: already as init writes it · kept: differs, left alone. */
export type InitOutcome = "created" | "updated" | "unchanged" | "kept";

export interface InitResult {
  actions: { path: string; outcome: InitOutcome }[];
  warnings: string[];
  /** The first-bootstrap step to print. */
  next: string;
}

const PKG_DIR = fileURLToPath(new URL("../", import.meta.url));
const SKILL_PREFIX = "agent-analyze-";
const SKILLS_REL = path.join(".agents", "skills");
const CLAUDE_SKILLS_REL = path.join(".claude", "skills");
const WORKFLOW_REL = path.join(".github", "workflows", "scv-check.yml");
const STORE_GLOB = ".scv/semantics/**";

/** Everything under .scv/ except the committed store is local or generated. */
const IGNORE_RULES = [
  ".scv/cache.sqlite",
  ".scv/cache.sqlite-*",
  ".scv/artifacts/",
  ".scv/snapshots/",
  ".scv/deltas/",
  ".scv/layouts/",
  ".scv/pending/",
  ".scv/config.yaml",
  ".scv/.semantics-staging/",
  ".scv/.semantics-old/",
];
const ATTRIBUTE_RULE = `${STORE_GLOB} linguist-generated=true`;
const AGENTS_RULE = "Before opening a PR, run the `agent-analyze-pr` skill.";
const WHOLE_SCV_IGNORE = /^\/?(\*\*\/)?\.scv(\/(\*\*?)?)?$/;

/** Branch, tag or sha — interpolated into the workflow, so no whitespace or shell metacharacters. */
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const OptionsSchema = z.object({
  install: z.enum(["npm", "git"], { message: "--install must be npm or git" }).optional(),
  gitRef: z.string().regex(GIT_REF, "--git-ref must be a branch, tag or commit sha").optional(),
});

/** The package this module ships in: its manifest, and its own git HEAD when run from a source checkout. */
export function bundledTool(): ToolInfo {
  const manifest = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf-8")) as {
    name: string;
    version: string;
    engines: { node: string };
    repository: { url: string };
  };
  return {
    name: manifest.name,
    version: manifest.version,
    nodeMajor: /\d+/.exec(manifest.engines.node)![0],
    repoUrl: manifest.repository.url.replace(/^git\+/, ""),
    checkoutSha: checkoutShaOf(PKG_DIR),
  };
}

function checkoutShaOf(dir: string): string | undefined {
  if (dir.split(path.sep).includes("node_modules")) return undefined;
  try {
    return git(dir, ["rev-parse", "--verify", "HEAD"]).trim();
  } catch {
    return undefined;
  }
}

/** The skills the build bundles into the package, else — in an unbuilt source checkout — the repo's own. */
function defaultSkillsDir(): string {
  const bundled = path.join(PKG_DIR, "skills");
  const source = path.join(PKG_DIR, "..", "..", SKILLS_REL);
  return existsSync(bundled) || !existsSync(source) ? bundled : source;
}

/** Every file under each bundled agent-analyze-* skill, relative to the skills directory. */
function bundledSkillFiles(skillsDir: string): string[] {
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((name) => name.startsWith(SKILL_PREFIX) && statSync(path.join(skillsDir, name)).isDirectory())
    : [];
  if (skills.length === 0) throw new Error(`no bundled ${SKILL_PREFIX}* skills in ${skillsDir} — rebuild the package`);
  const walk = (rel: string): string[] =>
    readdirSync(path.join(skillsDir, rel), { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .flatMap((entry) => {
        const child = path.join(rel, entry.name);
        return entry.isDirectory() ? walk(child) : [child];
      });
  return skills.sort().flatMap(walk);
}

function workflow(tool: ToolInfo, install: InstallMethod, gitRef: string | undefined): string {
  const head = [
    "# Written by `scv init`. Fails a PR whose committed .scv/semantics/ store is stale, missing or",
    "# orphaned entries; fix it with the agent-analyze-pr skill and commit the store.",
    "name: scv-check",
    "on:",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: actions/setup-node@v4",
    "        with:",
    `          node-version: "${tool.nodeMajor}"`,
  ];
  const check = (command: string) => [
    "      - name: scv check",
    "        env:",
    "          BASE_REF: ${{ github.base_ref }}",
    `        run: ${command} check --base "origin/$BASE_REF"`,
  ];
  if (install === "npm") return [...head, ...check(`npx --yes --package ${tool.name}@${tool.version} scv`)].join("\n") + "\n";

  // Quoted so YAML keeps an all-digit ref a string.
  const build = [
    "      - name: Build scv from source",
    "        env:",
    `          SCV_REPO: "${tool.repoUrl}"`,
    `          SCV_REF: "${gitRef}"`,
    "        run: |",
    '          git init -q "$RUNNER_TEMP/semviz"',
    '          git -C "$RUNNER_TEMP/semviz" remote add origin "$SCV_REPO"',
    '          git -C "$RUNNER_TEMP/semviz" fetch --depth 1 origin "$SCV_REF"',
    '          git -C "$RUNNER_TEMP/semviz" checkout -q FETCH_HEAD',
    '          cd "$RUNNER_TEMP/semviz" && npm ci && npm run build --workspace packages/cli',
  ];
  return [...head, ...build, ...check('node "$RUNNER_TEMP/semviz/packages/cli/dist/bin.js"')].join("\n") + "\n";
}

/**
 * `scv init [root]`: sets a repo up to commit its scv semantics — bundled agent-analyze-* skills,
 * a `.claude/skills` link, ignore rules for the local `.scv/` paths, a linguist-generated
 * attribute for the store, a pull-request workflow running `scv check`, and an AGENTS.md rule.
 * Idempotent: a file init owns is written only when absent, and a differing one is kept and
 * reported; shared files (.gitignore, .gitattributes, AGENTS.md) only gain what they lack.
 */
export function runInit(options: InitOptions): InitResult {
  const parsed = OptionsSchema.safeParse({ install: options.install, gitRef: options.gitRef });
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  const root = path.resolve(options.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);

  const tool = options.tool ?? bundledTool();
  const skillsDir = options.skillsDir ?? defaultSkillsDir();
  const skillFiles = bundledSkillFiles(skillsDir);
  const install = parsed.data.install ?? (tool.checkoutSha ? "git" : "npm");
  const gitRef = parsed.data.gitRef ?? tool.checkoutSha;
  if (install === "git" && !gitRef) throw new Error("--install git needs --git-ref <ref> when scv does not run from a source checkout");
  const workflowText = workflow(tool, install, gitRef);

  const actions: InitResult["actions"] = [];
  const warnings: string[] = [];
  const record = (rel: string, outcome: InitOutcome) => actions.push({ path: rel.split(path.sep).join("/"), outcome });

  const ensureFile = (rel: string, content: Buffer | string) => {
    const file = path.join(root, rel);
    // lstat, not exists: a dangling symlink here must be kept, never written through.
    if (lstatSync(file, { throwIfNoEntry: false })) {
      return record(rel, existsSync(file) && readFileSync(file).equals(Buffer.from(content)) ? "unchanged" : "kept");
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, { flag: "wx" });
    record(rel, "created");
  };
  /** Appends `missing(existing)` as its own paragraph, unless it returns nothing. */
  const appendMissing = (rel: string, missing: (existing: string) => string | undefined) => {
    const file = path.join(root, rel);
    const existing = existsSync(file) ? readFileSync(file, "utf-8") : undefined;
    const block = missing(existing ?? "");
    if (block === undefined) return record(rel, "unchanged");
    const prefix = existing ? (existing.endsWith("\n") ? existing : `${existing}\n`) + "\n" : "";
    writeFileSync(file, prefix + block);
    record(rel, existing === undefined ? "created" : "updated");
  };
  const linesOf = (text: string) => new Set(text.split("\n").map((line) => line.trim()));

  for (const rel of skillFiles) ensureFile(path.join(SKILLS_REL, rel), readFileSync(path.join(skillsDir, rel)));

  const linkTarget = path.relative(path.dirname(CLAUDE_SKILLS_REL), SKILLS_REL);
  const link = path.join(root, CLAUDE_SKILLS_REL);
  const linkStat = lstatSync(link, { throwIfNoEntry: false });
  if (!linkStat) {
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(linkTarget, link, "dir");
    record(CLAUDE_SKILLS_REL, "created");
  } else {
    record(CLAUDE_SKILLS_REL, linkStat.isSymbolicLink() && readlinkSync(link) === linkTarget ? "unchanged" : "kept");
  }

  appendMissing(".gitignore", (existing) => {
    const present = linesOf(existing);
    if ([...present].some((line) => WHOLE_SCV_IGNORE.test(line))) {
      warnings.push("`.scv/` is ignored as a whole by .gitignore, so .scv/semantics/ cannot be committed — remove that rule (init adds rules for the local .scv/ paths)");
    }
    const missing = IGNORE_RULES.filter((rule) => !present.has(rule));
    return missing.length === 0 ? undefined : ["# scv: local/generated state (only .scv/semantics/ is committed)", ...missing].join("\n") + "\n";
  });
  appendMissing(".gitattributes", (existing) => (linesOf(existing).has(ATTRIBUTE_RULE) ? undefined : `${ATTRIBUTE_RULE}\n`));
  ensureFile(WORKFLOW_REL, workflowText);
  appendMissing("AGENTS.md", (existing) => (existing.includes(AGENTS_RULE) ? undefined : `## scv semantics\n\n${AGENTS_RULE}\n`));

  const next = [
    "next: bootstrap the committed store — run the agent-analyze-repo skill, then commit it with the files above:",
    "  git add .scv/semantics/ && git commit -m \"chore: add scv semantics\"",
    ...(install === "git" ? [`CI builds scv from ${tool.repoUrl} at ${gitRef}; that ref must be reachable on the remote.`] : []),
  ].join("\n");
  return { actions, warnings, next };
}
