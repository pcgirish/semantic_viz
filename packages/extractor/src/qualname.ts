import path from "node:path";

/**
 * "src/orders/pricing.py" -> "src.orders.pricing"; "__init__.py" collapses to the package.
 * "src/widget.ts" -> "src.widget"; "index.ts" collapses to the package.
 */
export function moduleQualname(relPath: string): string {
  const noExt = relPath.replace(/\.(py|tsx?|jsx?|mjs|cjs)$/, "");
  const parts = noExt.split(path.sep);
  const last = parts[parts.length - 1];
  if (last === "__init__" || last === "index") parts.pop();
  return parts.join(".");
}
