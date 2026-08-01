import { runPassD, rankInspectQueue, type Provider } from "@scv/interpreter";
import type { Delta, Snapshot } from "@scv/schema";
import { runDiffer } from "./diff.js";

/** Triggers Pass D — a unit's semantics changed (or it was added/removed, which is always a semantics change) but was skipped for a text/struct-only reformat. */
function needsRiskNarration(fields: string[], status: string): boolean {
  return status === "added" || status === "removed" || fields.includes("semantics");
}

/** Runs the deterministic Differ, then narrates risk (Pass D) for every unit whose semantics changed and ranks the inspect queue — the Interpreter-in-the-loop half of the Differ. See analyze.md#3-4. */
export async function runDifferWithRisk(a: Snapshot, b: Snapshot, provider: Provider, promptRev: string): Promise<Delta> {
  const structural = runDiffer(a, b);
  const unitsB = new Map(b.units.map((u) => [u.id, u]));
  const unitsA = new Map(a.units.map((u) => [u.id, u]));

  const unitDeltas = await Promise.all(
    structural.unit_deltas.map(async (delta) => {
      if (!needsRiskNarration(delta.fields, delta.status)) return delta;

      const unit = unitsB.get(delta.unit) ?? unitsA.get(delta.unit);
      const passD = await runPassD({
        context: {
          qualname: delta.qualname,
          status: delta.status,
          what: unit?.semantics?.what ?? null,
          why: unit?.semantics?.why ?? null,
          blastRadius: delta.blast_radius,
          amount: delta.amount,
        },
        provider,
        promptRev,
      });

      return {
        ...delta,
        risk: {
          score: passD.score,
          axes: passD.axes,
          why: passD.why,
          confidence: passD.confidence,
          source: "llm" as const,
          formula_floor: delta.risk.formula_floor,
        },
      };
    }),
  );

  const narrated = unitDeltas.filter((d) => d.risk.source === "llm");
  const ranked = await rankInspectQueue({
    candidates: narrated.map((d) => ({
      unit: d.unit,
      qualname: d.qualname,
      status: d.status,
      score: d.risk.score ?? 0,
      confidence: d.risk.confidence,
      blastRadius: d.blast_radius,
      why: d.risk.why ?? "",
    })),
    provider,
    promptRev,
  });

  return {
    ...structural,
    unit_deltas: unitDeltas,
    inspect_queue: ranked.map((r) => ({
      rank: r.rank,
      unit: r.unit,
      qualname: r.qualname,
      status: r.status,
      risk: r.score,
      confidence: r.confidence,
    })),
  };
}
