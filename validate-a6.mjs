import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo } from "@scv/extractor";
import { runInterpreter, ClaudeCliProvider } from "@scv/interpreter";
import { runDifferWithRisk } from "@scv/differ";

const repoRoot = fileURLToPath(new URL("./fixtures/orderly", import.meta.url));
const BASE = "6ab4e5e";
const HEAD = "bed04b3";

function readSourceFactory(root) {
  return (file, start, end) => {
    const lines = execFileSync("git", ["-C", root, "show", `HEAD:${file}`], { encoding: "utf-8" }).split("\n");
    return lines.slice(start - 1, end).join("\n");
  };
}

async function snapshotAt(sha) {
  execFileSync("git", ["-C", repoRoot, "checkout", sha, "--quiet"]);
  const graph = extractRepo(repoRoot);
  const revLine = execFileSync("git", ["-C", repoRoot, "log", "-1", "--format=%H|%an|%aI"], { encoding: "utf-8" }).trim();
  const [fullSha, author, ts] = revLine.split("|");

  const structural = {
    schema: "scv/1",
    snapshot_id: `snap-${sha}`,
    repo: { root: "orderly", vcs: "git" },
    rev: { sha: fullSha, kind: "commit", author, author_kind: "human", ts },
    provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" } },
    units: graph.units.map((u) => ({
      id: u.id, kind: u.kind, name: u.name, qualname: u.qualname, lang: u.lang,
      parent: u.parent, children: u.children,
      loc: { files: [u.loc.file], start: u.loc.start, end: u.loc.end, sloc: u.sloc },
      signature: null, semantics: null, cost: null, tags: [],
      metrics: { fan_in: u.metrics.fanIn, fan_out: u.metrics.fanOut, churn: u.metrics.churn, commits: u.metrics.commits },
      authors: u.authors,
      hash: { struct: u.hash.struct, text: u.hash.text, semantic: null },
      provenance: { source: "static" },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id, from: e.from, to: e.to, kind: e.kind, weight: 1,
      evidence: [e.evidence], source: "static", confidence: e.confidence,
    })),
    externals: graph.externals.map((x) => ({
      id: x.id, ecosystem: x.ecosystem, name: x.name, version: x.version ?? "",
      direct: x.direct, depth: x.depth, reached_by: x.reachedBy,
      transitive_count: null, source: "static",
    })),
  };

  const provider = new ClaudeCliProvider({ model: "sonnet", effort: "low" });
  const lifted = await runInterpreter({
    snapshot: structural,
    graph,
    provider,
    promptRev: "a6-validate",
    readSource: readSourceFactory(repoRoot),
  });
  return lifted;
}

async function main() {
  console.log(`extracting+lifting ${BASE}...`);
  const a = await snapshotAt(BASE);
  console.log(`  ${a.units.length} units, ${a.edges.length} edges`);

  console.log(`extracting+lifting ${HEAD}...`);
  const b = await snapshotAt(HEAD);
  console.log(`  ${b.units.length} units, ${b.edges.length} edges`);

  execFileSync("git", ["-C", repoRoot, "checkout", "main", "--quiet"]);

  const provider = new ClaudeCliProvider({ model: "sonnet", effort: "low" });
  console.log("diffing + Pass D + ranking...");
  const delta = await runDifferWithRisk(a, b, provider, "a6-validate");

  console.log(`\ninspect_queue (${delta.inspect_queue.length}):`);
  for (const q of delta.inspect_queue) {
    console.log(`  ${q.rank}. ${q.qualname} — ${q.status}  risk ${q.risk.toFixed(2)}  conf ${q.confidence.toFixed(2)}`);
  }

  const outDir = mkdtempSync(path.join(tmpdir(), "a6-validate-"));
  const outPath = path.join(outDir, "delta.json");
  await import("node:fs").then((fs) => fs.writeFileSync(outPath, JSON.stringify(delta, null, 2)));
  console.log(`\nfull delta written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  execFileSync("git", ["-C", repoRoot, "checkout", "main", "--quiet"]);
  process.exit(1);
});
