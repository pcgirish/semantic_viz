import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runDifferWithRisk } from "@semviz/differ";
import { createProvider, loadInterpreterConfig, type Provider } from "@semviz/interpreter";
import {
  SnapshotSchema,
  formatFindings,
  validateSnapshotInvariants,
  type Delta,
  type Snapshot,
} from "@semviz/schema";

export interface RunDiffOptions {
  scvDir: string;
  from: string;
  to: string;
  provider?: Provider;
  promptRev?: string;
}

export interface RunDiffResult {
  delta: Delta;
  path: string;
}

function readSnapshot(scvDir: string, sha: string): Snapshot {
  const snapshotPath = path.join(scvDir, "snapshots", `${sha}.json`);
  if (!existsSync(snapshotPath)) {
    throw new Error(`no snapshot found for rev "${sha}" at ${snapshotPath} — run scv analyze at that rev first`);
  }
  // Reading is the trust boundary: a truncated or hand-edited snapshot should fail here,
  // naming the file, rather than as an opaque error somewhere inside the differ.
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch (cause) {
    throw new Error(`${snapshotPath}: not valid JSON`, { cause });
  }
  const parsed = SnapshotSchema.safeParse(json);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const at = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    throw new Error(`${snapshotPath}: does not match its schema${at}${issue ? `: ${issue.message}` : ""}`);
  }
  reportInvariantFindings(parsed.data, snapshotPath);
  return parsed.data;
}

/** Cap on findings printed per snapshot, so one pre-policy file cannot bury the diff output. */
const MAX_LOGGED_FINDINGS = 5;

/**
 * Logs referential-integrity findings without refusing to diff, matching the server's load policy.
 *
 * Every revision analyzed before the root policy landed has orphan modules, and some no system
 * unit at all. Refusing them would make `scv diff` unusable across all existing history, for
 * defects the user cannot fix except by re-analyzing both revisions. A defective hierarchy is
 * fatal where it is a bug — at analyze time, in `finalizeSnapshot` — and an observation here.
 */
function reportInvariantFindings(snapshot: Snapshot, file: string): void {
  const { findings } = validateSnapshotInvariants(snapshot);
  if (findings.length === 0) return;
  const shown = findings.slice(0, MAX_LOGGED_FINDINGS);
  const more = findings.length - shown.length;
  console.warn(
    `[WARN] ${file}: snapshot has ${findings.length} invariant finding(s)\n${formatFindings(shown)}` +
      (more > 0 ? `\n… and ${more} more` : ""),
  );
}

/** Reads two previously written snapshots by sha and writes their Differ output (with Pass D risk narration and ranking) to `<scvDir>/deltas/<from>__<to>.json`. */
export async function runDiff(options: RunDiffOptions): Promise<RunDiffResult> {
  const { scvDir, from, to } = options;
  const a = readSnapshot(scvDir, from);
  const b = readSnapshot(scvDir, to);

  const provider = options.provider ?? createProvider(loadInterpreterConfig(scvDir));
  const delta = await runDifferWithRisk(a, b, provider, options.promptRev ?? "p1");

  const deltasDir = path.join(scvDir, "deltas");
  mkdirSync(deltasDir, { recursive: true });
  const outPath = path.join(deltasDir, `${from}__${to}.json`);
  writeFileSync(outPath, JSON.stringify(delta, null, 2));

  return { delta, path: outPath };
}
