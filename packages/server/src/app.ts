import Fastify, { type FastifyInstance } from "fastify";
import { SnapshotStore, type Layout } from "./store.js";

export interface BuildAppOptions {
  scvDir: string;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify();
  const store = new SnapshotStore(options.scvDir);

  app.get("/api/revs", async () => store.listRevs());

  app.get<{ Params: { sha: string } }>("/api/snapshot/:sha", async (req, reply) => {
    const snapshot = store.getSnapshot(req.params.sha);
    if (!snapshot) return reply.code(404).send({ error: "snapshot not found" });
    return snapshot;
  });

  app.get<{ Params: { sha: string; id: string } }>("/api/snapshot/:sha/unit/:id", async (req, reply) => {
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
    const delta = store.getDelta(req.params.from, req.params.to);
    if (!delta) return reply.code(404).send({ error: "delta not found" });
    return delta;
  });

  app.get<{ Params: { sha: string; skin: string } }>("/api/layout/:sha/:skin", async (req, reply) => {
    const layout = store.getLayout(req.params.sha, req.params.skin);
    if (!layout) return reply.code(404).send({ error: "layout not found" });
    return layout;
  });

  app.put<{ Params: { sha: string; skin: string }; Body: Layout }>("/api/layout/:sha/:skin", async (req, reply) => {
    store.saveLayout(req.params.sha, req.params.skin, req.body);
    return reply.code(204).send();
  });

  return app;
}
