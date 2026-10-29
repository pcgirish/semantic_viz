import path from "node:path";
import { buildApp } from "@semviz/server";
import type { FastifyInstance } from "fastify";

export interface RunServeOptions {
  root: string;
  port: number;
}

export interface RunServeResult {
  app: FastifyInstance;
  scvDir: string;
  port: number;
}

export async function runServe({ root, port }: RunServeOptions): Promise<RunServeResult> {
  const scvDir = path.join(path.resolve(root), ".scv");
  const app = buildApp({ scvDir });
  await app.listen({ port, host: "127.0.0.1" });
  const actualPort = (app.server.address() as { port: number }).port;
  return { app, scvDir, port: actualPort };
}
