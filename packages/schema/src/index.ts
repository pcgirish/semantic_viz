import { z } from "zod";

const UnitId = z.string();
const EdgeId = z.string();
const ExternalId = z.string();

export const UnitKindSchema = z.enum([
  "system",
  /** An architectural grouping of layers, derived by Pass C. Sits between the system and its
   *  layers, so the root is a handful of named domains rather than every layer at once. */
  "group",
  "layer",
  "module",
  "class",
  "function",
  "api_flow",
  "block",
  /** Container for modules no layer claimed, so every unit has a parent. Purely structural:
   *  never LLM-analyzed, and empty containers are not emitted. */
  "unclustered",
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
  "control_flow",
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

// kind:"api_flow" only — branch-preserving trace, additive to `steps` (docs/design.md#api-flow).
export interface StepBranch {
  unit: string;
  label?: string;
  children?: StepBranch[];
}

const StepBranchSchema: z.ZodType<StepBranch> = z.lazy(() =>
  z.object({
    unit: UnitId,
    label: z.string().optional(),
    children: z.array(StepBranchSchema).optional(),
  })
);

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
  // kind:"api_flow" only — branching form of `steps`; present when the traced flow has
  // fan-out (e.g. success/failure paths), absent for a purely linear flow.
  stepsBranching: StepBranchSchema.optional(),
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
  // Present iff `rollup` is true: which concrete edges this aggregate stands for. Optional in
  // the schema so snapshots written before this field still parse — enforcement that a *new*
  // rollup carries it lives in `validateEdgeInvariants`, not here.
  rollupProvenance: z
    .object({
      edges: z.array(EdgeId), // contributing edge ids, sorted ascending
      count: z.number().int(), // == edges.length; explicit so consumers need not derive it
      weight: z.number(), // summed weight of the contributors
    })
    .optional(),
  // kind:"control_flow" only — which branch this edge represents.
  flowType: z.enum(["sequential", "true", "false", "loop-back", "exception"]).optional(),
  // kind:"control_flow", flowType:"true"|"false" only — semantic branch label (e.g. "invalid"/
  // "valid") from the decision block's own labeling pass. The raw true/false truth value only
  // reads as generic "yes"/"no" when it happens to match the block label's polarity, so callers
  // should prefer this over a hardcoded true->yes/false->no mapping when present.
  edgeLabel: z.string().optional(),
  // kind:"control_flow" only — true when this edge is a raise/throw exit, even if flowType
  // carries a branch ("true"/"false") rather than "exception" — lets a flowchart render it
  // as a risk path (red) while still using the branch's semantic edgeLabel.
  raises: z.boolean().optional(),
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

/** How the layer partition was computed. Optional: snapshots written before layers became
 *  deterministic have no such record, and they stay loadable. */
const ClusteringProvenanceSchema = z.object({
  algorithm: z.string(),
  version: z.string(),
  tieBreak: z.string(),
  constants: z.record(z.string(), z.number()),
});

const SnapshotProvenanceSchema = z.object({
  extractor: z.string(),
  interpreter: InterpreterProvenanceSchema,
  clustering: ClusteringProvenanceSchema.optional(),
});

/** Upper bound on persisted layout entries — a repo far larger than any this tool targets. */
const MAX_LAYOUT_NODES = 100_000;

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

// `moved` and `renamed` are deliberately absent: they need rename-detection heuristics no
// differ here implements, and a schema that permits a status nothing can emit reads as a
// capability the tool does not have. Add them back alongside the differ that produces them.
const UnitDeltaStatusSchema = z.enum([
  "added",
  "removed",
  "modified",
  "risk_changed",
  "unchanged",
]);

/**
 * Lineage across a reclustering, emitted only by the group matcher, which computes it from member
 * overlap. Statuses stay as they are — a split group is `added` plus a `relationship`, and its
 * predecessor `removed` plus the mirrored one — so the schema never advertises a status nothing
 * can produce.
 */
export const UnitRelationshipSchema = z.object({
  kind: z.enum(["split", "merged"]),
  /** Unit ids on the other side, sorted ascending so two runs byte-compare. */
  counterparts: z.array(UnitId),
});

export type UnitRelationship = z.infer<typeof UnitRelationshipSchema>;

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
  relationship: UnitRelationshipSchema.optional(),
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

/**
 * Seeded node positions for replay stability (docs/serve.md#3). Persisted per snapshot+skin
 * and written straight from an HTTP body, so the bounds here are the only thing standing
 * between an untrusted request and the layouts directory.
 */
export const LayoutSchema = z.object({
  // Non-finite coordinates round-trip through JSON as `null` and corrupt the stored layout.
  nodeX: z.record(z.string(), z.number().finite()).refine(
    (nodeX) => Object.keys(nodeX).length <= MAX_LAYOUT_NODES,
    { message: `layout exceeds ${MAX_LAYOUT_NODES} nodes` },
  ),
});

export type Layout = z.infer<typeof LayoutSchema>;

export {
  validateTreeInvariants,
  validateEdgeInvariants,
  validateSnapshotInvariants,
  formatFindings,
  type Finding,
  type Severity,
  type ValidationResult,
} from "./invariants.js";

export { normalizeText, semanticHashInput, type SemanticFields } from "./normalize.js";
