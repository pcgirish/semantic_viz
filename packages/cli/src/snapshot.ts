import { createHash } from "node:crypto";
import path from "node:path";
import type { SymbolEdge, SymbolExternal, SymbolGraph, SymbolUnit } from "@semviz/extractor";
import type { Edge, External, Snapshot, Unit } from "@semviz/schema";
import type { HeadRev } from "./rev.js";

export interface ToSnapshotOptions {
  root: string;
  rev: HeadRev | Snapshot["rev"];
  repoName?: string;
}

function toUnit(unit: SymbolUnit): Unit {
  return {
    id: unit.id,
    kind: unit.kind,
    name: unit.name,
    qualname: unit.qualname,
    lang: unit.lang,
    parent: unit.parent,
    children: unit.children,
    loc: { files: [unit.loc.file], start: unit.loc.start, end: unit.loc.end, sloc: unit.sloc },
    signature: null,
    semantics: null,
    cost: null,
    tags: [],
    metrics: {
      fan_in: unit.metrics.fanIn,
      fan_out: unit.metrics.fanOut,
      churn: unit.metrics.churn,
      commits: unit.metrics.commits,
    },
    authors: unit.authors,
    hash: { struct: unit.hash.struct, text: unit.hash.text, semantic: null },
    provenance: { source: "static" },
  };
}

function toEdge(edge: SymbolEdge): Edge {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    weight: 1,
    evidence: [edge.evidence],
    source: "static",
    confidence: edge.confidence,
  };
}

function toExternal(external: SymbolExternal): External {
  return {
    id: external.id,
    ecosystem: external.ecosystem as External["ecosystem"],
    name: external.name,
    version: external.version ?? "",
    direct: external.direct,
    depth: external.depth,
    reached_by: external.reachedBy,
    transitive_count: null,
    source: "static",
  };
}

/** Maps a deterministic SymbolGraph onto the scv/1 Snapshot contract; semantics/signature/cost stay null until an Interpreter pass lifts them. */
export function toSnapshot(graph: SymbolGraph, options: ToSnapshotOptions): Snapshot {
  // Resolve first: `path.basename(".")` is "." and would name the repo after the flag, not the directory.
  const repoName = options.repoName ?? path.basename(path.resolve(options.root));
  const rev = options.rev;
  const snapshotId = createHash("sha1").update(`${repoName}:${rev.sha}`).digest("hex");

  return {
    schema: "scv/1",
    snapshot_id: snapshotId,
    repo: { root: repoName, vcs: "git" },
    rev,
    provenance: {
      extractor: "scv-ts/0.1.0",
      interpreter: { model: "none", prompt_rev: "none" },
    },
    units: graph.units.map(toUnit),
    edges: graph.edges.map(toEdge),
    externals: graph.externals.map(toExternal),
  };
}
