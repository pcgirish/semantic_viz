import type { Box } from "./place.js";
import type { SceneLink } from "./scene.js";
import { isDummy } from "./expand.js";

export type RouteChain = {
  from: string;
  to: string;
  nodes: string[]; // real endpoints + dummy waypoints, in rank order (from expand.ts)
  id: string;
  ids: string[]; // all bundled edge ids sharing this (from, to) pair
  kind: string;
  back?: true;
  weight?: number;
  unresolved?: boolean;
};

function centre(box: Box): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

const PORT_INSET = 14;

/** Foundations render above their dependents (see place.ts), so dependency edges flow
 * upward on screen: a node's out-edges fan across its top border, in-edges across its
 * bottom, ordered by
 * the other end's x — otherwise every edge into/out of a node lands on the same pixel and
 * the last stretch of many edges draws on top of each other (implement-serve.md fix #3). */
function spreadPorts(
  chains: RouteChain[],
  boxes: Map<string, Box>,
): { outPort: Map<string, { x: number; y: number }>; inPort: Map<string, { x: number; y: number }> } {
  const outByNode = new Map<string, { chainIndex: number; otherX: number }[]>();
  const inByNode = new Map<string, { chainIndex: number; otherX: number }[]>();

  chains.forEach((c, i) => {
    if (c.back || c.nodes.length < 2) return;
    const first = c.nodes[0]!;
    const second = c.nodes[1]!;
    const last = c.nodes[c.nodes.length - 1]!;
    const secondLast = c.nodes[c.nodes.length - 2]!;
    const secondBox = boxes.get(second);
    const secondLastBox = boxes.get(secondLast);
    if (!secondBox || !secondLastBox) return;
    const outs = outByNode.get(first) ?? [];
    outs.push({ chainIndex: i, otherX: centre(secondBox).x });
    outByNode.set(first, outs);
    const ins = inByNode.get(last) ?? [];
    ins.push({ chainIndex: i, otherX: centre(secondLastBox).x });
    inByNode.set(last, ins);
  });

  function assign(byNode: Map<string, { chainIndex: number; otherX: number }[]>, y: (box: Box) => number) {
    const port = new Map<number, { x: number; y: number }>();
    for (const [nodeId, entries] of byNode) {
      const box = boxes.get(nodeId);
      if (!box) continue;
      const sorted = [...entries].sort((a, b) => a.otherX - b.otherX);
      const inset = Math.min(PORT_INSET, box.w * 0.2);
      const span = box.w - 2 * inset;
      sorted.forEach((e, i) => {
        const x = isDummy(nodeId)
          ? box.x + box.w / 2
          : box.x + inset + span * (sorted.length === 1 ? 0.5 : i / (sorted.length - 1));
        port.set(e.chainIndex, { x, y: y(box) });
      });
    }
    return port;
  }

  const outPortByIndex = assign(outByNode, (box) => box.y);
  const inPortByIndex = assign(inByNode, (box) => box.y + box.h);

  const outPort = new Map<string, { x: number; y: number }>();
  const inPort = new Map<string, { x: number; y: number }>();
  chains.forEach((c, i) => {
    const o = outPortByIndex.get(i);
    if (o) outPort.set(c.id, o);
    const p = inPortByIndex.get(i);
    if (p) inPort.set(c.id, p);
  });
  return { outPort, inPort };
}

/**
 * Turns dummy-expanded chains into drawable SceneLinks: bundles are already collapsed by
 * expand.ts's chain-per-edge-pair shape (route just trusts `ids`), each chain's path walks
 * through every waypoint the chain passes (docs/serve.md#3, "bundling" + fix #2's dummy
 * routing), and out/in ports fan across node borders instead of converging on centre pixels
 * (fix #3). Lane assignment is a left-to-right sweep over target x (docs/serve.md#3,
 * "lane assignment").
 */
export function route(chains: RouteChain[], boxes: Map<string, Box>): SceneLink[] {
  const valid = chains.filter((c) => c.nodes.every((n) => boxes.has(n)));

  // Bundle chains sharing a (from, to) pair into one, keeping the first chain's waypoints
  // (they share rank span, so the dummy path is the same) and merging their edge ids.
  const bundled = new Map<string, RouteChain>();
  for (const c of valid) {
    const key = `${c.from}->${c.to}`;
    const existing = bundled.get(key);
    if (existing) {
      existing.ids.push(...c.ids);
      existing.weight = Math.max(existing.weight ?? 0, c.weight ?? 0);
      // One inferred contributor makes the whole bundle inferred: a reader must not have an
      // unverified edge hidden inside an otherwise-solid connector.
      existing.unresolved = existing.unresolved || c.unresolved;
    } else {
      bundled.set(key, { ...c, ids: [...c.ids] });
    }
  }
  const merged = [...bundled.values()];

  const { outPort, inPort } = spreadPorts(merged, boxes);

  const sorted = merged
    .map((c) => ({ c, targetX: centre(boxes.get(c.to)!).x }))
    .sort((a, b) => a.targetX - b.targetX || a.c.from.localeCompare(b.c.from));

  return sorted.map(({ c }, lane) => {
    const points = c.nodes.map((n) => centre(boxes.get(n)!));
    if (points.length > 0) {
      const start = outPort.get(c.id);
      if (start) points[0] = start;
      const end = inPort.get(c.id);
      if (end) points[points.length - 1] = end;
    }
    return {
      id: c.id,
      from: c.from,
      to: c.to,
      path: points,
      lane,
      bundle: c.ids,
      kind: c.kind,
      state: "current",
      weight: c.weight,
      unresolved: c.unresolved,
    };
  });
}
