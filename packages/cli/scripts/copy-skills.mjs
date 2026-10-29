// Copies the agent-analyze-* skills into the package so they ship with the published CLI.
// Usage: node copy-skills.mjs [source-skills-dir] [dest-dir]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(process.argv[2] ?? path.join(pkgDir, "../../.agents/skills"));
const dest = path.resolve(process.argv[3] ?? path.join(pkgDir, "skills"));

const skills = existsSync(source)
  ? readdirSync(source).filter((name) => name.startsWith("agent-analyze-") && statSync(path.join(source, name)).isDirectory())
  : [];
if (skills.length === 0) {
  console.error(`error: no agent-analyze-* skills in ${source}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const name of skills) cpSync(path.join(source, name), path.join(dest, name), { recursive: true, dereference: true });
