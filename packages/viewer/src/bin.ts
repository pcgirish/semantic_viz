#!/usr/bin/env node
import { Command } from "commander";
import { runServe } from "./serve.js";
import { runUi } from "./ui.js";

const program = new Command();

program.name("scv-viewer").description("local web viewer for scv snapshots");

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
  .description("serve the built SPA and proxy /api/* to a running `scv-viewer serve` process")
  .option("--port <n>", "port to listen on", "5173")
  .option("--api-port <n>", "port of the running `scv-viewer serve` process to proxy /api/* to", "3000")
  .action(async (opts: { port: string; apiPort: string }) => {
    const { port } = await runUi({ port: Number(opts.port), apiPort: Number(opts.apiPort) });
    console.log(`serving UI on http://127.0.0.1:${port} (proxying /api to http://127.0.0.1:${opts.apiPort})`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
