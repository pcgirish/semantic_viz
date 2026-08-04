#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runAnalyze, type RunAnalyzeOptions } from "./analyze.js";
import { runDiff } from "./diff.js";

const program = new Command();

program.name("scv").description("semantic code visualizer");

program
  .command("analyze")
  .description("extract a repo, lift semantics/clustering, and write a scv/1 snapshot to .scv/snapshots/")
  .argument("[root]", "repo root to analyze", ".")
  .option("--provider <name>", "interpreter provider: ollama | anthropic | claude-cli; persisted to .scv/config.yaml")
  .option("--model <name>", "interpreter model; persisted to .scv/config.yaml")
  .option("--effort <level>", "interpreter effort: low | medium | high | xhigh | max; persisted to .scv/config.yaml")
  .option("--log-level <level>", "llm call logging: info; persisted to .scv/config.yaml")
  .action(async (root: string, opts: { provider?: string; model?: string; effort?: string; logLevel?: string }) => {
    const { path: outPath, snapshot, usage } = await runAnalyze({
      root,
      providerName: opts.provider as RunAnalyzeOptions["providerName"],
      model: opts.model,
      effort: opts.effort as RunAnalyzeOptions["effort"],
      logLevel: opts.logLevel as RunAnalyzeOptions["logLevel"],
    });
    console.log(
      `wrote ${outPath} (${snapshot.units.length} units, ${snapshot.edges.length} edges, ${snapshot.externals.length} externals)`,
    );
    console.log(
      `usage: input tokens=${usage.inputTokens}, output tokens=${usage.outputTokens}, calls=${usage.calls}, cache hits=${usage.cacheHits}`,
    );
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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
