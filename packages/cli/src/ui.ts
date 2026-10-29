import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import proxy from "@fastify/http-proxy";
import Fastify, { type FastifyInstance } from "fastify";

export interface RunUiOptions {
  port: number;
  apiPort: number;
  /** Directory containing the built SPA (index.html + assets). Defaults to @semviz/ui's dist. */
  distDir?: string;
}

export interface RunUiResult {
  app: FastifyInstance;
  port: number;
}

function resolveDefaultDistDir(): string {
  const uiPkg = new URL(import.meta.resolve("@semviz/ui/package.json"));
  return path.join(path.dirname(uiPkg.pathname), "dist");
}

export async function runUi({ port, apiPort, distDir }: RunUiOptions): Promise<RunUiResult> {
  const dist = distDir ?? resolveDefaultDistDir();

  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error(
      `UI not built — expected ${path.join(dist, "index.html")} to exist. Run \`npm run build --workspace packages/ui\` first.`,
    );
  }

  const app = Fastify();

  await app.register(proxy, {
    upstream: `http://127.0.0.1:${apiPort}`,
    prefix: "/api",
    rewritePrefix: "/api",
  });

  await app.register(fastifyStatic, {
    root: dist,
  });

  app.setNotFoundHandler(async (_req, reply) => {
    return reply.sendFile("index.html");
  });

  await app.listen({ port, host: "127.0.0.1" });
  const actualPort = (app.server.address() as { port: number }).port;
  return { app, port: actualPort };
}
