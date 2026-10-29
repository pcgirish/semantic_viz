import { createHash } from "node:crypto";
import { semanticHashInput, type Unit } from "@semviz/schema";
import type { Provider } from "./provider.js";

/**
 * Group units — the architectural tier between the system and its layers.
 *
 * Pass C proposes groups as *names of layers*, which is the wrong currency to build with: layer
 * names come from an LLM and nothing enforces that they are unique. Name resolution therefore
 * happens once, at the boundary, and everything downstream keys on stable layer ids.
 */

/**
 * Fixed id for the bucket holding layers Pass C assigned to no group. Fixed rather than derived
 * from its membership, so a layer entering or leaving the bucket does not read as the bucket
 * itself being removed and re-added.
 */
export const UNGROUPED_ID = "u:group:ungrouped";

export interface BuildGroupUnitsInput {
  layerUnits: Unit[];
  /** Group name -> member layer **ids**, already resolved by `resolveGroupMembership`. */
  groups: Record<string, string[]>;
  systemId: string;
  provider: Provider;
}

export interface BuildGroupUnitsResult {
  groupUnits: Unit[];
  /** Layer id -> the group id it now parents to. Applied by `finalizeSnapshot`. */
  layerParent: Map<string, string>;
}

/**
 * Converts Pass C's group-name -> layer-**name** mapping into group-name -> layer-**id**.
 *
 * Every failure here is fatal. Neither Pass B nor Pass C enforces layer-name uniqueness, so a
 * collision means two distinct layers are indistinguishable in the model's output and no winner
 * can be picked honestly; an unknown name means the model invented a layer, so its whole grouping
 * is suspect. Repairing rather than failing is what produced the hierarchy this work exists to fix.
 */
export function resolveGroupMembership(groups: Record<string, string[]>, layerUnits: Unit[]): Record<string, string[]> {
  const idsByName = new Map<string, string[]>();
  for (const layer of layerUnits) {
    const existing = idsByName.get(layer.name);
    if (existing) existing.push(layer.id);
    else idsByName.set(layer.name, [layer.id]);
  }

  const collisions = [...idsByName].filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    const detail = collisions.map(([name, ids]) => `"${name}" -> ${ids.sort().join(", ")}`).join("; ");
    throw new Error(
      `pass C groups: layer names are not unique, so group membership cannot be resolved: ${detail}. ` +
        `Raw grouping: ${JSON.stringify(groups)}`,
    );
  }

  const resolved: Record<string, string[]> = {};
  const unknown: string[] = [];
  for (const [groupName, layerNames] of Object.entries(groups)) {
    const ids: string[] = [];
    for (const layerName of layerNames) {
      const [id] = idsByName.get(layerName) ?? [];
      if (id === undefined) unknown.push(`"${layerName}" (in group "${groupName}")`);
      else ids.push(id);
    }
    resolved[groupName] = ids;
  }

  if (unknown.length > 0) {
    throw new Error(
      `pass C groups: grouping references layers that do not exist: ${unknown.join(", ")}. ` +
        `Raw grouping: ${JSON.stringify(groups)}`,
    );
  }

  return resolved;
}

/**
 * Builds one complete group unit per group — parent, children, hashes, metrics and all — plus the
 * reparenting map for its member layers. Units leave here complete; `finalizeSnapshot` only
 * attaches them, so there is exactly one owner of a group's shape.
 */
export function buildGroupUnits(input: BuildGroupUnitsInput): BuildGroupUnitsResult {
  const { layerUnits, groups, systemId, provider } = input;
  const layerById = new Map(layerUnits.map((l) => [l.id, l]));

  const claimedBy = new Map<string, string>();
  for (const [groupName, memberIds] of Object.entries(groups)) {
    if (memberIds.length === 0) {
      throw new Error(`pass C groups: group "${groupName}" has no members`);
    }
    for (const id of memberIds) {
      if (!layerById.has(id)) {
        throw new Error(`pass C groups: group "${groupName}" claims layer '${id}', which is not a layer`);
      }
      const owner = claimedBy.get(id);
      if (owner !== undefined) {
        throw new Error(`pass C groups: layer '${id}' is claimed by both "${owner}" and "${groupName}"`);
      }
      claimedBy.set(id, groupName);
    }
  }

  const named = Object.entries(groups).map(([name, memberIds]) => ({ name, memberIds, id: groupIdFor(memberIds) }));
  const ungrouped = layerUnits.filter((l) => !claimedBy.has(l.id)).map((l) => l.id);
  const all = ungrouped.length > 0 ? [...named, { name: "Ungrouped", memberIds: ungrouped, id: UNGROUPED_ID }] : named;

  const layerParent = new Map<string, string>();
  const groupUnits = all.map(({ name, memberIds, id }) => {
    const members = [...memberIds].sort();
    for (const memberId of members) layerParent.set(memberId, id);
    return buildGroupUnit({ id, name, members, layerById, systemId, provider, isBucket: id === UNGROUPED_ID });
  });

  return { groupUnits, layerParent };
}

/** Derived from member ids only — never the name, which an LLM rechooses on every run. */
function groupIdFor(memberIds: string[]): string {
  return `u:group:${createHash("sha1").update([...memberIds].sort().join("\n")).digest("hex").slice(0, 12)}`;
}

function buildGroupUnit(options: {
  id: string;
  name: string;
  members: string[];
  layerById: Map<string, Unit>;
  systemId: string;
  provider: Provider;
  isBucket: boolean;
}): Unit {
  const { id, name, members, layerById, systemId, provider, isBucket } = options;
  const memberUnits = members.map((memberId) => layerById.get(memberId)!);

  return {
    id,
    kind: "group",
    name,
    qualname: name,
    lang: undefined,
    parent: systemId,
    children: members,
    loc: {
      files: [...new Set(memberUnits.flatMap((m) => m.loc.files))].sort(),
      start: null,
      end: null,
      sloc: memberUnits.reduce((sum, m) => sum + m.loc.sloc, 0),
    },
    // Pass C returns memberships and a name, not what/how/why. Deriving prose by concatenating
    // member-layer semantics would produce text no human wrote and no model endorsed, so groups
    // ship unnarrated until a group-narration pass lands.
    semantics: null,
    cost: null,
    tags: [],
    metrics: {
      layers: members.length,
      modules: memberUnits.reduce((sum, m) => sum + (m.metrics.modules ?? 0), 0),
    },
    authors: undefined,
    hash: {
      struct: createHash("sha1").update(members.join("\n")).digest("hex"),
      text: null,
      // Always computed, never null. Groups have no semantics yet, so the name alone drives it —
      // which is the point: a nullable hash would compare equal on both sides and make every
      // group rename invisible for exactly as long as the narration pass is missing.
      semantic: createHash("sha1").update(semanticHashInput(name, null)).digest("hex"),
    },
    provenance: isBucket ? { source: "static" } : { source: "llm", pass: "C", provider: provider.name, model: provider.model },
  };
}
