import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { LayoutSchema, type Layout } from "@semviz/schema";
import { isSafePathSegment, SnapshotStore } from "./store.js";

export interface BuildAppOptions {
  scvDir: string;
}

/**
 * Rejects a param that could escape its directory once interpolated into a filename. Fastify
 * hands params over percent-decoded, so `..%2F` and `%2e%2e%2f` both arrive here as `../` —
 * only a check after decoding sees them. 400 rather than 404: a traversal attempt is a bad
 * request, and collapsing it into "not found" hides the rejection from tests.
 */
function rejectUnsafe(reply: FastifyReply, params: Record<string, string>): boolean {
  for (const [name, value] of Object.entries(params)) {
    if (!isSafePathSegment(value)) {
      reply.code(400).send({ error: `invalid ${name}` });
      return true;
    }
  }
  return false;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "error" } });
  const store = new SnapshotStore(options.scvDir);

  app.get("/api/revs", async () => store.listRevs());

  app.get<{ Params: { sha: string } }>("/api/snapshot/:sha", async (req, reply) => {
    if (rejectUnsafe(reply, req.params)) return reply;
    const snapshot = store.getSnapshot(req.params.sha);
    if (!snapshot) return reply.code(404).send({ error: "snapshot not found" });
    return snapshot;
  });

  app.get<{ Params: { sha: string; id: string } }>("/api/snapshot/:sha/unit/:id", async (req, reply) => {
    // `id` is matched against unit ids in memory, never joined into a path, so it is not checked.
    if (rejectUnsafe(reply, { sha: req.params.sha })) return reply;
    const result = store.getUnit(req.params.sha, req.params.id);
    if (!result) return reply.code(404).send({ error: "unit not found" });
    return result;
  });

  app.get<{ Querystring: { q?: string } }>("/api/search", async (req, reply) => {
    const q = req.query.q;
    if (!q) return reply.code(400).send({ error: "missing query parameter q" });
    const latest = store.getLatestSnapshot();
    if (!latest) return [];
    return store.search(latest.rev.sha, q);
  });

  app.get<{ Params: { from: string; to: string } }>("/api/delta/:from/:to", async (req, reply) => {
    if (rejectUnsafe(reply, req.params)) return reply;
    const delta = store.getDelta(req.params.from, req.params.to);
    if (!delta) return reply.code(404).send({ error: "delta not found" });
    return delta;
  });

  app.get<{ Params: { sha: string; skin: string } }>("/api/layout/:sha/:skin", async (req, reply) => {
    if (rejectUnsafe(reply, req.params)) return reply;
    const layout = store.getLayout(req.params.sha, req.params.skin);
    if (!layout) return reply.code(404).send({ error: "layout not found" });
    return layout;
  });

  app.put<{ Params: { sha: string; skin: string }; Body: Layout }>("/api/layout/:sha/:skin", async (req, reply) => {
    if (rejectUnsafe(reply, req.params)) return reply;
    // `Body: Layout` above is a compile-time assertion only — the body is whatever JSON arrived.
    const parsed = LayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      return reply.code(400).send({ error: `invalid layout${issue ? `: ${issue.message}` : ""}` });
    }
    store.saveLayout(req.params.sha, req.params.skin, parsed.data);
    return reply.code(204).send();
  });

  return app;
}
