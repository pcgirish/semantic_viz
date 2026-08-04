import { z } from "zod";

const UnitId = z.string();
const EdgeId = z.string();
const ExternalId = z.string();

export const UnitKindSchema = z.enum([
  "system",
  "layer",
  "module",
  "package",
  "class",
  "function",
  "api_flow",
  "block",
  "config",
]);

export const EdgeKindSchema = z.enum([
  "calls",
  "imports",
  "inherits",
  "implements",
  "reads",
  "writes",
  "emits",
  "handles",
  "configures",
  "tests",
]);

const SourceSchema = z.enum(["static", "llm"]);

const PortSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  nullable: z.boolean().optional(),
  description: z.string().optional(),
  source: SourceSchema.optional(),
});

const SignatureSchema = z
  .object({
    in: z.array(PortSchema),
    out: z.array(PortSchema),
    raises: z.array(z.string()),
    async: z.boolean(),
  })
  .nullable();

const SemanticsSchema = z
  .object({
    what: z.string(),
    how: z.string(),
    when: z.string(),
    where: z.string(),
    why: z.string(),
    confidence: z.number().min(0).max(1),
    source: SourceSchema,
  })
  .nullable();

const CostSchema = z
  .object({
    complexity: z.number().optional(),
    io: z.array(z.string()).optional(),
    estimate: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    source: z.enum(["static", "llm"]).optional(),
  })
  .nullable();

const LocSchema = z.object({
  files: z.array(z.string()),
  start: z.number().nullable().optional(),
  end: z.number().nullable().optional(),
  sloc: z.number(),
});

const AuthorSchema = z.object({
  name: z.string(),
  lines: z.number(),
});

const HashSchema = z.object({
  struct: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  semantic: z.string().nullable().optional(),
});

const UnitProvenanceSchema = z.object({
  source: z.enum(["static", "llm"]),
  pass: z.enum(["A", "B", "C", "D"]).optional(),
});

export const UnitSchema = z.object({
  id: UnitId,
  kind: UnitKindSchema,
  name: z.string(),
  qualname: z.string(),
  lang: z.string().optional(),
  parent: UnitId.nullable(),
  children: z.array(UnitId),
  loc: LocSchema,
  signature: SignatureSchema.optional(),
  semantics: SemanticsSchema.optional(),
  cost: CostSchema.optional(),
  tags: z.array(z.string()),
  metrics: z.record(z.string(), z.number()),
  authors: z.array(AuthorSchema).optional(),
  hash: HashSchema,
  provenance: UnitProvenanceSchema,
  // kind:"api_flow" only (docs/serve.md#4 "Flows") — the route string and the ordered
  // unit ids the request actually traverses, at whatever granularity the trace reached.
  route: z.string().optional(),
  steps: z.array(UnitId).optional(),
  // kind:"layer" only — the architectural group (e.g. "api surface") this layer belongs
  // to, one level above layer in the hierarchy without being a new parent/child edge.
  group: z.string().optional(),
});

const EvidenceSchema = z.object({
  file: z.string(),
  line: z.number(),
});

export const EdgeSchema = z.object({
  id: EdgeId,
  from: UnitId,
  to: UnitId,
  kind: EdgeKindSchema,
  weight: z.number(),
  evidence: z.array(EvidenceSchema).optional(),
  source: SourceSchema,
  confidence: z.number().min(0).max(1),
  rollup: z.boolean().optional(),
});

export const ExternalSchema = z.object({
  id: ExternalId,
  ecosystem: z.enum(["pypi", "npm", "maven", "go", "cargo", "service"]),
  name: z.string(),
  version: z.string(),
  direct: z.boolean(),
  depth: z.number(),
  reached_by: z.array(UnitId),
  transitive_count: z.number().nullable(),
  license: z.string().optional(),
  advisories: z.number().optional(),
  source: SourceSchema.optional(),
});

const RevSchema = z.object({
  sha: z.string(),
  kind: z.enum(["commit", "pr", "tag"]),
  pr: z.number().optional(),
  ts: z.string(),
  author: z.string(),
  author_kind: z.string(),
  message: z.string().optional(),
});

const InterpreterProvenanceSchema = z.object({
  provider: z.string().optional(),
  model: z.string(),
  prompt_rev: z.string(),
});

const SnapshotProvenanceSchema = z.object({
  extractor: z.string(),
  interpreter: InterpreterProvenanceSchema,
});

export const SnapshotSchema = z.object({
  schema: z.literal("scv/1"),
  snapshot_id: z.string(),
  repo: z.object({
    root: z.string(),
    vcs: z.string(),
  }),
  rev: RevSchema,
  provenance: SnapshotProvenanceSchema,
  units: z.array(UnitSchema),
  edges: z.array(EdgeSchema),
  externals: z.array(ExternalSchema),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type External = z.infer<typeof ExternalSchema>;

const InspectQueueEntrySchema = z.object({
  rank: z.number(),
  unit: UnitId,
  qualname: z.string(),
  status: z.string(),
  risk: z.number(),
  confidence: z.number().min(0).max(1),
  ground_truth: z.string().optional(),
});

const RiskAxesSchema = z.object({
  functionality: z.number(),
  availability: z.number(),
  scalability: z.number(),
  performance: z.number(),
  security: z.number(),
});

const RiskSchema = z.object({
  score: z.number().nullable(),
  axes: RiskAxesSchema.nullable(),
  why: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["llm", "formula"]),
  formula_floor: z.number().optional(),
  rank: z.number().optional(),
  ground_truth: z.string().optional(),
});

const BlastRadiusSchema = z.object({
  direct: z.number(),
  transitive: z.number(),
  public_api: z.boolean(),
});

const UnitDeltaStatusSchema = z.enum([
  "added",
  "removed",
  "moved",
  "renamed",
  "modified",
  "risk_changed",
  "unchanged",
]);

export const UnitDeltaSchema = z.object({
  unit: UnitId,
  qualname: z.string(),
  kind: UnitKindSchema,
  status: UnitDeltaStatusSchema,
  fields: z.array(z.string()),
  amount: z.number().min(0).max(1),
  blast_radius: BlastRadiusSchema,
  authors: z.array(AuthorSchema),
  risk: RiskSchema,
});

const EdgeDeltaStatusSchema = z.enum(["added", "removed", "reweighted"]);

export const EdgeDeltaSchema = z.object({
  edge: EdgeId,
  from: UnitId,
  to: UnitId,
  kind: EdgeKindSchema,
  status: EdgeDeltaStatusSchema,
});

const RollupEntrySchema = z.object({
  amount: z.number(),
  risk: z.number().nullable(),
  sloc: z.number(),
});

const SnapshotRefSchema = z.object({
  snapshot_id: z.string(),
  sha: z.string(),
});

const DeltaProvenanceSchema = SnapshotProvenanceSchema.extend({
  formulas: z.record(z.string(), z.string()),
});

export const DeltaSchema = z.object({
  schema: z.literal("scv-delta/1"),
  from: SnapshotRefSchema,
  to: SnapshotRefSchema,
  provenance: DeltaProvenanceSchema,
  inspect_queue: z.array(InspectQueueEntrySchema),
  unit_deltas: z.array(UnitDeltaSchema),
  edge_deltas: z.array(EdgeDeltaSchema),
  rollup: z.record(z.string(), RollupEntrySchema),
});

export type Delta = z.infer<typeof DeltaSchema>;
export type UnitDelta = z.infer<typeof UnitDeltaSchema>;
export type EdgeDelta = z.infer<typeof EdgeDeltaSchema>;
