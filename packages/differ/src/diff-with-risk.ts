import { runPassD, rankInspectQueue, type Provider } from "@scv/interpreter";
import type { Delta, Snapshot, UnitDelta } from "@scv/schema";
import { runDiffer } from "./diff.js";

/**
 * The inspect queue surfaces module-level risk, not every function/class delta underneath it —
 * a human reviewing a PR thinks in terms of "the rate limiter module", not each of its methods.
 * layer/system units are excluded too: they're LLM-invented groupings whose identity churns
 * whenever Pass B/C reclusters, which is not a risk a human should be asked to inspect. `group`
 * is excluded for the same reason and more so — it is a grouping *of* those groupings — and
 * `test_suite` because it is a structural bucket that is never analyzed at all. Both fall out of
 * this allowlist without needing to be named; they are listed here so the omission reads as a
 * decision rather than an oversight.
 */
const NARRATABLE_KINDS = new Set(["module"]);

/**
 * Triggers Pass D for any module that changed at all. Unlike leaf units, a module's own
 * `semantic_hash` is never computed (only function/class units get one from Pass A), so gating
 * on `fields.includes("semantics")` would never fire — a text-only edit like a config value
 * tuned or a log format reworded is exactly the kind of module-level change worth narrating,
 * even though no individual function's meaning changed.
 */
function needsRiskNarration(delta: UnitDelta): boolean {
  return NARRATABLE_KINDS.has(delta.kind) && delta.status !== "unchanged";
}

/** Runs the deterministic Differ, then narrates risk (Pass D) for every unit whose semantics changed and ranks the inspect queue — the Interpreter-in-the-loop half of the Differ. See analyze.md#3-4. */
export async function runDifferWithRisk(a: Snapshot, b: Snapshot, provider: Provider, promptRev: string): Promise<Delta> {
  const structural = runDiffer(a, b);
  const unitsB = new Map(b.units.map((u) => [u.id, u]));
  const unitsA = new Map(a.units.map((u) => [u.id, u]));

  const unitDeltas = await Promise.all(
    structural.unit_deltas.map(async (delta) => {
      if (!needsRiskNarration(delta)) return delta;

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
          // design.md#risk — the formula sets a floor; Pass D may raise the score above it,
          // never lower it. Without the clamp an LLM underestimate silently buries a risky change.
          score: delta.risk.formula_floor === undefined
            ? passD.score
            : Math.max(passD.score, delta.risk.formula_floor),
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
