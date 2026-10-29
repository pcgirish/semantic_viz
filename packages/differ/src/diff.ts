import type { Delta, Edge, Snapshot, Unit, UnitDelta } from "@semviz/schema";
import { matchGroupLineage } from "./group-lineage.js";

const BLAST_RADIUS_CAP = 4;

function blastRadius(units: Map<string, Unit>, edges: Edge[], unitId: string): { direct: number; transitive: number } {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge.from);
  }

  const direct = (incoming.get(unitId) ?? []).length;
  const seen = new Set<string>();
  let frontier = [unitId];
  for (let depth = 0; depth < BLAST_RADIUS_CAP; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const parent of incoming.get(node) ?? []) {
        if (!seen.has(parent)) {
          seen.add(parent);
          next.push(parent);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return { direct, transitive: seen.size };
}

function isPublicApi(unit: Unit): boolean {
  return (unit.tags ?? []).some((t) => t === "public-api" || t === "auth-boundary");
}

/**
 * True when a unit's exposure differs between the two snapshots — either the number of callers
 * reaching it changed, or it crossed the public-API boundary. Both raise or lower how much a
 * future change to this unit would cost, without the unit itself having been touched.
 */
function exposureChanged(
  unitsA: Map<string, Unit>,
  edgesA: Edge[],
  unitsB: Map<string, Unit>,
  edgesB: Edge[],
  unitId: string,
): boolean {
  const before = blastRadius(unitsA, edgesA, unitId);
  const after = blastRadius(unitsB, edgesB, unitId);
  if (before.direct !== after.direct || before.transitive !== after.transitive) return true;
  return isPublicApi(unitsA.get(unitId)!) !== isPublicApi(unitsB.get(unitId)!);
}

function classify(ua: Unit | undefined, ub: Unit | undefined): { status: UnitDelta["status"]; amount: number; fields: string[] } {
  if (ua && !ub) return { status: "removed", amount: 1, fields: ["removed"] };
  if (ub && !ua) return { status: "added", amount: 1, fields: ["added"] };
  const a = ua!;
  const b = ub!;

  const textChanged = a.hash.text !== b.hash.text;
  const structChanged = a.hash.struct !== b.hash.struct;
  const semanticChanged = a.hash.semantic !== b.hash.semantic;
  const fields = [
    ...(textChanged ? ["hash.text"] : []),
    ...(structChanged ? ["hash.struct"] : []),
    ...(semanticChanged ? ["semantics"] : []),
  ];

  if (!textChanged && !structChanged && !semanticChanged) {
    return { status: "unchanged", amount: 0, fields };
  }

  const slocDelta = Math.abs(b.loc.sloc - a.loc.sloc) / Math.max(a.loc.sloc, 1);
  const amount = Math.min(
    1,
    0.4 * Math.min(slocDelta + (textChanged ? 0.3 : 0), 1) + (structChanged ? 0.3 : 0) + (semanticChanged ? 0.3 : 0),
  );
  return { status: "modified", amount: Math.round(amount * 1000) / 1000, fields };
}

function formulaFloor(amount: number, transitive: number, publicApi: boolean): number {
  const floor = amount * (0.5 + 0.5 * Math.min(transitive / 12, 1)) * (publicApi ? 1.4 : 1);
  return Math.round(Math.min(1, floor) * 1000) / 1000;
}

function edgeDeltas(a: Snapshot, b: Snapshot): Delta["edge_deltas"] {
  const ea = new Map(a.edges.map((e) => [e.id, e]));
  const eb = new Map(b.edges.map((e) => [e.id, e]));
  const ids = new Set([...ea.keys(), ...eb.keys()]);
  const out: Delta["edge_deltas"] = [];

  for (const id of [...ids].sort()) {
    const before = ea.get(id);
    const after = eb.get(id);
    if (!before && after) {
      out.push({ edge: id, from: after.from, to: after.to, kind: after.kind, status: "added" });
    } else if (before && !after) {
      out.push({ edge: id, from: before.from, to: before.to, kind: before.kind, status: "removed" });
    } else if (before && after && before.weight !== after.weight) {
      out.push({ edge: id, from: after.from, to: after.to, kind: after.kind, status: "reweighted" });
    }
  }
  return out;
}

function rollup(units: Map<string, Unit>, deltaByUnit: Map<string, UnitDelta>): Delta["rollup"] {
  const result: Delta["rollup"] = {};

  function visit(unitId: string): { amount: number; risk: number; sloc: number } {
    const unit = units.get(unitId);
    if (!unit) return { amount: 0, risk: 0, sloc: 0 };

    const children = unit.children ?? [];
    if (children.length === 0) {
      const own = deltaByUnit.get(unitId);
      return { amount: own?.amount ?? 0, risk: own?.risk.score ?? 0, sloc: unit.loc.sloc };
    }

    let totalAmountSloc = 0;
    let totalSloc = 0;
    let maxRisk = 0;
    for (const childId of children) {
      const child = visit(childId);
      totalAmountSloc += child.amount * child.sloc;
      totalSloc += child.sloc;
      maxRisk = Math.max(maxRisk, child.risk);
    }

    const own = deltaByUnit.get(unitId);
    if (own) {
      totalAmountSloc += own.amount * unit.loc.sloc;
      totalSloc += unit.loc.sloc;
      maxRisk = Math.max(maxRisk, own.risk.score ?? 0);
    }

    const amount = totalSloc > 0 ? Math.round((totalAmountSloc / totalSloc) * 1000) / 1000 : 0;
    result[unitId] = { amount, risk: Math.round(maxRisk * 1000) / 1000, sloc: totalSloc };
    return { amount, risk: maxRisk, sloc: totalSloc };
  }

  const roots = [...units.values()].filter((u) => u.parent === null);
  for (const root of roots) visit(root.id);
  return result;
}

/** Diffs two scv/1 snapshots: matches units by id, classifies change from hash comparison, computes blast radius and a formula-floor risk, and rolls amount/risk up to every ancestor. Risk narration (Pass D) overrides the formula floor for units whose semantic_hash changed; wiring that in is a separate step. */
export function runDiffer(a: Snapshot, b: Snapshot): Delta {
  const unitsA = new Map(a.units.map((u) => [u.id, u]));
  const unitsB = new Map(b.units.map((u) => [u.id, u]));
  const allIds = new Set([...unitsA.keys(), ...unitsB.keys()]);

  // Computed over both snapshots up front: a split or merge is a statement about the whole
  // reclustering, not something any single unit's before/after pair can reveal.
  const lineage = matchGroupLineage(a.units, b.units);

  const unitDeltas: UnitDelta[] = [];
  for (const id of [...allIds].sort()) {
    const ua = unitsA.get(id);
    const ub = unitsB.get(id);
    const classified = classify(ua, ub);
    const { amount } = classified;
    let { status, fields } = classified;

    const unit = ub ?? ua!;
    const referenceSnapshot = ub ? b : a;
    const referenceUnits = ub ? unitsB : unitsA;
    const { direct, transitive } = blastRadius(referenceUnits, referenceSnapshot.edges, id);
    const publicApi = isPublicApi(unit);

    // A unit whose own bytes are identical can still have become riskier: more code now reaches
    // it, or it crossed into the public API. That is invisible to `classify`, which sees only the
    // two units — exposure is a property of the surrounding graph, so it is compared here.
    if (status === "unchanged" && ua && ub && exposureChanged(unitsA, a.edges, unitsB, b.edges, id)) {
      status = "risk_changed";
      fields = ["blast_radius"];
    }
    if (status === "unchanged") continue;

    // `amount` stays 0 for risk_changed, so the floor does too: a change in exposure is worth
    // surfacing, but it is not evidence that this unit's own code became more likely to break.
    const floor = formulaFloor(amount, transitive, publicApi);

    unitDeltas.push({
      unit: id,
      qualname: unit.qualname,
      kind: unit.kind,
      status,
      fields,
      amount,
      blast_radius: { direct, transitive, public_api: publicApi },
      authors: unit.authors ?? [],
      risk: { score: floor, axes: null, why: null, confidence: 0.5, source: "formula", formula_floor: floor },
      ...(lineage.has(id) ? { relationship: lineage.get(id) } : {}),
    });
  }

  const deltaByUnit = new Map(unitDeltas.map((d) => [d.unit, d]));

  return {
    schema: "scv-delta/1",
    from: { snapshot_id: a.snapshot_id, sha: a.rev.sha },
    to: { snapshot_id: b.snapshot_id, sha: b.rev.sha },
    provenance: {
      ...b.provenance,
      formulas: {
        amount: "0.4*text_diff + 0.3*struct_changed + 0.3*semantic_drift",
        risk_floor: "amount * (0.5 + 0.5*norm(blast.transitive)) * boost(public_api)",
        rollup_amount: "sloc-weighted mean of children",
        rollup_risk: "max of children",
      },
    },
    inspect_queue: [],
    unit_deltas: unitDeltas,
    edge_deltas: edgeDeltas(a, b),
    rollup: rollup(unitsB.size > 0 ? unitsB : unitsA, deltaByUnit),
  };
}
