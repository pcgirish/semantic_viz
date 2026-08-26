#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { fmtElapsed } from "@scv/interpreter";
import { runAnalyze, type RunAnalyzeOptions } from "./analyze.js";
import { runDiff } from "./diff.js";
import { runMergeSemantics } from "./merge-semantics.js";
import { runServe } from "./serve.js";
import { runUi } from "./ui.js";

const program = new Command();

program.name("scv").description("semantic code visualizer");

program
  .command("analyze")
  .description("extract a repo, lift semantics/clustering, and write a scv/1 snapshot to .scv/snapshots/")
  .argument("[root]", "repo root to analyze", ".")
  .argument("[artifact]", "compute only this artifact: functions | docs | clusters | layers | groups | flows")
  .option("--provider <name>", "interpreter provider: ollama | anthropic | claude-cli; persisted to .scv/config.yaml")
  .option("--model <name>", "interpreter model; persisted to .scv/config.yaml")
  .option("--effort <level>", "interpreter effort: low | medium | high | xhigh | max; persisted to .scv/config.yaml")
  .option("--log-level <level>", "llm call logging: info; persisted to .scv/config.yaml")
  .option("--no-llm", "merge from cache only — never call a provider; artifacts with no cache use an empty default")
  .option(
    "--force",
    "recompute the target artifact even if its cached inputs are unchanged; downstream artifacts recompute only if the forced output actually differs; requires [artifact]",
  )
  .option(
    "--scope <entries...>",
    "restrict Pass A to: everything (default/'all'), files changed vs HEAD~1 ('changed'), or unit-id globs (e.g. 'u:src.handlers.**', 'u:src.*.create_order')",
  )
  .action(async (root: string, artifact: string | undefined, opts: { provider?: string; model?: string; effort?: string; logLevel?: string; llm: boolean; force?: boolean; scope?: string[] }) => {
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
        `[WARN] snapshot merged without: ${emptyArtifacts.join(", ")} — run ${emptyArtifacts.map((a) => `'scv analyze ${a}'`).join(" / ")} for full narration`,
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
  .option("--with-flows", "also merge pending flow narration into the flows artifact (requires live extraction; not supported with a historical --sha)")
  .option(
    "--sha <sha>",
    "sha to merge against; defaults to HEAD. Merges against the persisted .scv/snapshots/<sha>.json when present, otherwise extracts the current worktree.",
  )
  .action(async (pendingFile: string, root: string, opts: { scope?: string[]; withClustering?: boolean; withGroups?: boolean; withFlows?: boolean; sha?: string }) => {
    const result = await runMergeSemantics({
      root,
      pendingFile,
      scope: opts.scope,
      withClustering: opts.withClustering,
      withGroups: opts.withGroups,
      withFlows: opts.withFlows,
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
  .command("serve")
  .description("serve the JSON API for a previously analyzed repo's .scv snapshots")
  .argument("[root]", "repo root whose .scv dir to serve", ".")
  .option("--port <n>", "port to listen on", process.env.PORT ?? "3000")
  .action(async (root: string, opts: { port: string }) => {
    const { scvDir, port } = await runServe({ root, port: Number(opts.port) });
    console.log(`serving ${scvDir} on http://127.0.0.1:${port}`);
  });

program
  .command("ui")
  .description("serve the built SPA and proxy /api/* to a running `scv serve` process")
  .option("--port <n>", "port to listen on", "5173")
  .option("--api-port <n>", "port of the running `scv serve` process to proxy /api/* to", "3000")
  .action(async (opts: { port: string; apiPort: string }) => {
    const { port } = await runUi({ port: Number(opts.port), apiPort: Number(opts.apiPort) });
    console.log(`serving UI on http://127.0.0.1:${port} (proxying /api to http://127.0.0.1:${opts.apiPort})`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
