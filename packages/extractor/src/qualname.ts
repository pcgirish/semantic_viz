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

const TEST_DIR_SEGMENT = /^(tests?|__tests__)$/;
const TEST_FILENAME = /^(test_.+|.+_test|.+\.test|.+\.spec)$/;

/** True for files that live under a tests/test/__tests__ directory, or whose own filename
 *  marks it as a test (test_*.py, *_test.py, *.test.ts(x), *.spec.ts(x)). */
export function isTestPath(relPath: string): boolean {
  const parts = relPath.split(path.sep);
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => TEST_DIR_SEGMENT.test(d))) return true;
  const filename = parts[parts.length - 1] ?? "";
  const noExt = filename.replace(/\.(py|tsx?|jsx?|mjs|cjs)$/, "");
  return TEST_FILENAME.test(noExt);
}

const GENERATED_DIR_SEGMENT = /^(generated|__generated__)$/;
const GENERATED_FILENAME = /(_pb2\.py|_pb\.py|\.pb\.ts|\.generated\.ts|\.g\.dart)$/;

/** True for machine-generated files: anything under a `generated`/`__generated__` directory,
 *  or whose filename carries a generator's suffix (`*_pb2.py`, `*.pb.ts`, `*.generated.ts`,
 *  `*.g.dart`). Such files are real code but say nothing about architecture — their imports
 *  reflect a code generator's conventions, not a developer's design — so they are kept out of
 *  the clustering graph while still being snapshotted. */
export function isGeneratedPath(relPath: string): boolean {
  const parts = relPath.split(path.sep);
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => GENERATED_DIR_SEGMENT.test(d))) return true;
  return GENERATED_FILENAME.test(parts[parts.length - 1] ?? "");
}

/**
 * Collapses a test-owned module qualname to at most one level under the first
 * tests/test/__tests__ path segment, e.g. "tests.integration.api.test_deep" (from
 * "tests/integration/api/test_deep.py") -> "tests.integration". Non-test qualnames pass
 * through unchanged.
 */
export function flattenTestQualname(qualname: string, relPath: string): string {
  if (!isTestPath(relPath)) return qualname;
  const dirs = relPath.split(path.sep).slice(0, -1);
  const testDirIdx = dirs.findIndex((d) => TEST_DIR_SEGMENT.test(d));
  if (testDirIdx === -1) return qualname;
  const subDirCount = dirs.length - testDirIdx - 1; // directories nested below the test dir
  const qualnameParts = qualname.split(".");
  const keep = testDirIdx + 1 + Math.min(subDirCount, 1); // test dir itself, + one level under it if present
  return qualnameParts.slice(0, keep).join(".");
}
