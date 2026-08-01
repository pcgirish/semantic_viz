#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runAnalyze } from "./analyze.js";
import { runDiff } from "./diff.js";

const program = new Command();

program.name("scv").description("semantic code visualizer");

program
  .command("analyze")
  .description("extract a repo, lift semantics/clustering, and write a scv/1 snapshot to .scv/snapshots/")
  .argument("[root]", "repo root to analyze", ".")
  .action(async (root: string) => {
    const { path: outPath, snapshot } = await runAnalyze({ root });
    console.log(
      `wrote ${outPath} (${snapshot.units.length} units, ${snapshot.edges.length} edges, ${snapshot.externals.length} externals)`,
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

program.parseAsync(process.argv);
