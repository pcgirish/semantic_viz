const NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

/** Points for a regular n-gon (or a 24-gon standing in for a circle when n=0) centred at (cx, cy). */
export function ngon(cx: number, cy: number, r: number, sides: number): Array<[number, number]> {
  const n = sides || 24;
  const rot = -Math.PI / 2;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * 2 * Math.PI;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

export function ptstr(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
