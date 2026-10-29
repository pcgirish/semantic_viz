// Builds the publishable dist/: the CLI with @semviz/server inlined (npm dependencies stay
// external) plus the prebuilt SPA, so the package needs no private workspace at runtime.
import { chmodSync, cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgDir = fileURLToPath(new URL("../", import.meta.url));
const dist = `${pkgDir}dist`;
const uiDist = `${pkgDir}../ui/dist`;
const { dependencies } = JSON.parse(readFileSync(`${pkgDir}package.json`, "utf-8"));

if (!existsSync(`${uiDist}/index.html`)) {
  throw new Error(`UI not built — expected ${uiDist}/index.html; run \`npm run build --workspace packages/ui\` first`);
}

rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: [`${pkgDir}build/bin.js`],
  outfile: `${dist}/bin.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: Object.keys(dependencies),
  logLevel: "warning",
});
chmodSync(`${dist}/bin.js`, 0o755);
cpSync(uiDist, `${dist}/ui`, { recursive: true });
