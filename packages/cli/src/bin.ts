#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { fmtElapsed } from "@semviz/interpreter";
import { runAnalyze, type RunAnalyzeOptions } from "./analyze.js";
import { ARTIFACT_NAMES } from "./artifacts.js";
import { runCheck } from "./check.js";
import { runDiff } from "./diff.js";
import { runExport } from "./export.js";
import { runHydrate } from "./hydrate.js";
import { runInit, type InitOptions } from "./init.js";
import { runMergeSemantics } from "./merge-semantics.js";

const program = new Command();

program.name("scv").description("semantic code visualizer");

program
  .command("analyze")
  .description("extract a repo, lift semantics/clustering, and write a scv/1 snapshot to .scv/snapshots/")
  .argument("[root]", "repo root to analyze", ".")
  .argument("[artifact]", "compute only this artifact: extraction | functions | docs | clusters | layers | groups | flows")
  .option("--provider <name>", "interpreter provider: ollama | anthropic | claude-cli; persisted to .scv/config.yaml")
  .option("--model <name>", "interpreter model; persisted to .scv/config.yaml")
  .option("--effort <level>", "interpreter effort: low | medium | high | xhigh | max; persisted to .scv/config.yaml")
  .option("--log-level <level>", "llm call logging: info; persisted to .scv/config.yaml")
  .option(
    "--no-llm",
    "never call a provider; without [artifact] merges from cache with empty defaults, with [artifact] also computes that stage if it is deterministic (clusters)",
  )
  .option(
    "--force",
    "recompute the target artifact even if its cached inputs are unchanged; downstream artifacts recompute only if the forced output actually differs; requires [artifact]",
  )
  .option(
    "--scope <entries...>",
    "restrict Pass A to: everything (default/'all'), files changed vs HEAD~1 ('changed'), or unit-id globs (e.g. 'u:src.handlers.**', 'u:src.*.create_order')",
  )
  .action(async (root: string, artifact: string | undefined, opts: { provider?: string; model?: string; effort?: string; logLevel?: string; llm: boolean; force?: boolean; scope?: string[] }) => {
    // A lone positional is always [root], so `scv analyze functions` would silently analyze a
    // ./functions directory; refuse to guess which one was meant.
    if (artifact === undefined && (ARTIFACT_NAMES as string[]).includes(root)) {
      throw new Error(
        [
          `"${root}" is ambiguous: it is an artifact name, but a single argument is read as the repo root to analyze.`,
          `  to compute the ${root} artifact of the current repo:  scv analyze . ${root}`,
          `  to analyze the directory ./${root} as a repo:          scv analyze ./${root}`,
        ].join("\n"),
      );
    }
    const { path: outPath, snapshot, usage, elapsedMs, emptyArtifacts } = await runAnalyze({
      root,
      providerName: opts.provider as RunAnalyzeOptions["providerName"],
      model: opts.model,
      effort: opts.effort as RunAnalyzeOptions["effort"],
      logLevel: opts.logLevel as RunAnalyzeOptions["logLevel"],
      artifact: artifact as RunAnalyzeOptions["artifact"],
      force: opts.force,
      noLlm: !opts.llm,
      scope: opts.scope,
    });
    console.log(
      `wrote ${outPath} (${snapshot.units.length} units, ${snapshot.edges.length} edges, ${snapshot.externals.length} externals)`,
    );
    console.log(
      `elapsed: ${fmtElapsed(elapsedMs)} (llm calls: ${fmtElapsed(usage.totalDurationMs)})`,
    );
    console.log(
      `usage: input tokens=${usage.inputTokens}, output tokens=${usage.outputTokens}, calls=${usage.calls}, cache hits=${usage.cacheHits}`,
    );
    if (emptyArtifacts.length > 0) {
      console.error(
        `[WARN] snapshot merged without: ${emptyArtifacts.join(", ")} — run ${emptyArtifacts.map((a) => `'scv analyze ${root} ${a}'`).join(" / ")} for full narration`,
      );
    }
  });

program
  .command("diff")
  .description("diff two previously written snapshots and write a scv-delta/1 file to .scv/deltas/")
  .argument("<from>", "sha of the base snapshot")
  .argument("<to>", "sha of the head snapshot")
  .option("--scv-dir <dir>", "directory containing snapshots/ and deltas/", ".scv")
  .action(async (from: string, to: string, opts: { scvDir: string }) => {
    const { path: outPath, delta } = await runDiff({ scvDir: path.resolve(opts.scvDir), from, to });
    console.log(
      `wrote ${outPath} (${delta.unit_deltas.length} unit deltas, ${delta.edge_deltas.length} edge deltas, queue of ${delta.inspect_queue.length})`,
    );
  });

program
  .command("merge-semantics")
  .description("inject agent-authored Pass A/C semantics from a pending-semantics file into the artifact cache and writes a merged snapshot — no LLM calls")
  .argument("<pending-file>", "path to the pending-semantics JSON file")
  .argument("[root]", "repo root to analyze", ".")
  .option(
    "--scope <entries...>",
    "restrict merge to: all pending entries (default/'all'), files changed vs HEAD~1 ('changed'), or unit-id globs (e.g. 'u:src.handlers.**')",
  )
  .option("--with-clustering", "also run Pass B clustering (deterministic, no LLM) and merge pending layer narration")
  .option("--with-groups", "also merge pending group narration into the groups artifact (requires a fresh layers artifact)")
  .option("--with-docs", "also merge pending doc extracts into the docs artifact (the zero-LLM stand-in for Pass Docs; merged before clustering, which consumes it)")
  .option("--with-flows", "also merge pending flow narration into the flows artifact (requires live extraction; not supported with a historical --sha)")
  .option(
    "--sha <sha>",
    "sha to merge against; defaults to HEAD. Merges against the persisted .scv/snapshots/<sha>.json when present, otherwise extracts the current worktree.",
  )
  .action(async (pendingFile: string, root: string, opts: { scope?: string[]; withClustering?: boolean; withGroups?: boolean; withFlows?: boolean; withDocs?: boolean; sha?: string }) => {
    const result = await runMergeSemantics({
      root,
      pendingFile,
      scope: opts.scope,
      withClustering: opts.withClustering,
      withGroups: opts.withGroups,
      withFlows: opts.withFlows,
      withDocs: opts.withDocs,
      sha: opts.sha,
    });
    console.log(`merged ${result.merged}, skipped ${result.skipped}`);
    console.log(`wrote ${result.path}`);
    if (result.emptyArtifacts.length > 0) {
      console.error(`[WARN] snapshot merged without: ${result.emptyArtifacts.join(", ")}`);
    }
    for (const warning of result.warnings) console.error(`[WARN] ${warning}`);
  });

program
  .command("export")
  .description("publish the semantics authored at HEAD into the committed store .scv/semantics/ — entries whose stamp is stale are kept as they were, entries for removed units/docs are pruned")
  .argument("[root]", "repo root", ".")
  .action((root: string) => {
    const result = runExport({ root: path.resolve(root) });
    console.log(`exported ${result.functions} function/class and ${result.docs} doc entries to ${result.dir}`);
    if (result.stale > 0) console.error(`[WARN] ${result.stale} stale entries kept unchanged — re-author them and export again`);
  });

program
  .command("hydrate")
  .description("seed .scv/artifacts/<sha>/ from the semantics committed at a revision, keeping only entries still fresh against that revision's structure — no LLM calls")
  .argument("[rev]", "commit-ish to hydrate", "HEAD")
  .argument("[root]", "repo root", ".")
  .action(async (rev: string, root: string) => {
    const result = await runHydrate({ root: path.resolve(root), rev });
    console.log(`hydrated ${result.sha}: merged ${result.merged}, skipped ${result.skipped}`);
    console.log(`wrote ${result.path}`);
    if (result.stale > 0) console.error(`[WARN] ${result.stale} committed entries are stale at ${result.sha} and were not hydrated`);
    if (result.emptyArtifacts.length > 0) console.error(`[WARN] snapshot hydrated without: ${result.emptyArtifacts.join(", ")}`);
    for (const warning of result.warnings) console.error(`[WARN] ${warning}`);
  });

program
  .command("check")
  .description("list committed semantics that must be re-authored — stale, missing or orphaned entries, each with the skill that fixes it; exits 1 on any finding")
  .argument("[root]", "repo root", ".")
  .option("--base <ref>", "report function findings only for units whose inputs changed since `git merge-base <ref> HEAD`; docs and global artifacts are always checked")
  .option("--json", "print { ok, base, items } as JSON instead of tab-separated status, kind, id, skill lines")
  .action(async (root: string, opts: { base?: string; json?: boolean }) => {
    const result = await runCheck({ root: path.resolve(root), base: opts.base });
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else for (const item of result.items) console.log([item.status, item.kind, item.id, item.skill].join("\t"));
    if (!result.ok) process.exitCode = 1;
  });

program
  .command("init")
  .description("set a repo up to commit its scv semantics: agent-analyze-* skills, .gitignore/.gitattributes rules, a pull-request scv check workflow and an AGENTS.md rule — never overwrites a modified file")
  .argument("[root]", "repo root", ".")
  .option("--install <method>", "how CI installs scv: npm (published package) | git (build from source at --git-ref); defaults to git from a source checkout, else npm")
  .option("--git-ref <ref>", "commit CI builds scv from with --install git: a full sha, or a branch/tag of this checkout (pinned to its sha); defaults to HEAD")
  .action((root: string, opts: { install?: string; gitRef?: string }) => {
    const result = runInit({ root, install: opts.install as InitOptions["install"], gitRef: opts.gitRef });
    for (const action of result.actions) console.log(`${action.outcome}\t${action.path}`);
    for (const warning of result.warnings) console.error(`[WARN] ${warning}`);
    console.log(`\n${result.next}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
