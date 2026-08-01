#!/usr/bin/env node
import { Command } from "commander";
import { runAnalyze } from "./analyze.js";

const program = new Command();

program.name("scv").description("semantic code visualizer");

program
  .command("analyze")
  .description("extract a repo and write a scv/1 snapshot to .scv/snapshots/")
  .argument("[root]", "repo root to analyze", ".")
  .action(async (root: string) => {
    const { path: outPath, snapshot } = await runAnalyze({ root });
    console.log(
      `wrote ${outPath} (${snapshot.units.length} units, ${snapshot.edges.length} edges, ${snapshot.externals.length} externals)`,
    );
  });

program.parseAsync(process.argv);
