import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import proxy from "@fastify/http-proxy";
import Fastify, { type FastifyInstance } from "fastify";

export interface RunUiOptions {
  port: number;
  apiPort: number;
  /** Directory containing the built SPA (index.html + assets). Defaults to the copy bundled in this package. */
  distDir?: string;
}

export interface RunUiResult {
  app: FastifyInstance;
  port: number;
}

// The build copies the SPA to dist/ui/. Resolving from this module works both bundled (dist/bin.js) and from source (src/ui.ts).
const BUNDLED_UI_DIR = fileURLToPath(new URL("../dist/ui/", import.meta.url));

export async function runUi({ port, apiPort, distDir }: RunUiOptions): Promise<RunUiResult> {
  const dist = distDir ?? BUNDLED_UI_DIR;

  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error(
      `UI not built — expected ${path.join(dist, "index.html")} to exist. Run \`npm run build\` first.`,
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
