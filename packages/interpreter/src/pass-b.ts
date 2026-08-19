import { z } from "zod";
import type { Provider } from "./provider.js";
import { passBPrompt } from "./prompts/pass-b.js";
import { checkAndRepairClusters, directoryClusters, modularity } from "./checker.js";
import type { ClusterProposal, ImportEdge } from "./checker.js";
import { interpretJsonWithRetry } from "./retry.js";

const MergesMapSchema = z.record(z.string(), z.array(z.string()));

function isMergesWrapped(value: Record<string, string[]> | { merges: Record<string, string[]> }): value is {
  merges: Record<string, string[]>;
} {
  return "merges" in value && !Array.isArray(value.merges) && typeof value.merges === "object";
}

// Some local models may drop the "merges" wrapper — accept both shapes.
const PassBResponseSchema = z
  .union([z.object({ merges: MergesMapSchema }), MergesMapSchema])
  .transform((value) => (isMergesWrapped(value) ? value : { merges: value }));

export interface PassBResult {
  clusters: ClusterProposal;
  repaired: boolean;
  modularity: number;
  directoryModularity: number;
}

export interface RunPassBOptions {
  files: string[];
  oneLiners: Record<string, string>;
  edges: ImportEdge[];
  provider: Provider;
  promptRev: string;
  repoContext?: string;
}

/**
 * Applies directory merges to the base directory partition: directories listed in merges
 * are combined with the merge's name; unlisted directories stay as singletons under their own name.
 */
function applyDirectoryMerges(baseClusters: ClusterProposal, merges: Record<string, string[]>): { proposal: ClusterProposal; repaired: boolean } {
  const allDirs = new Set(Object.keys(baseClusters));
  const proposal: ClusterProposal = {};
  let repaired = false;

  const seenDirs = new Set<string>();

  for (const [mergeName, dirNames] of Object.entries(merges)) {
    const mergedFiles: string[] = [];
    for (const dir of dirNames) {
      if (!allDirs.has(dir)) {
        repaired = true;
        continue;
      }
      if (seenDirs.has(dir)) {
        repaired = true;
        continue;
      }
      seenDirs.add(dir);
      mergedFiles.push(...(baseClusters[dir] ?? []));
    }
    if (mergedFiles.length === 0) {
      if (dirNames.length > 0) repaired = true;
      continue;
    }
    // A merge name identical to a directory left unmerged would silently clobber that
    // directory's own singleton entry below (both use the same proposal key); identical to
    // one of its own merged directory names reads as that directory nesting inside itself
    // once rendered — rename the merge in either case rather than losing data or rendering
    // a self-nested group.
    let name = mergeName;
    if ((allDirs.has(name) && !seenDirs.has(name)) || dirNames.includes(name)) {
      repaired = true;
      name = `${mergeName}_group`;
    }
    proposal[name] = mergedFiles;
  }

  // Singleton clusters for directories not mentioned in any merge
  for (const dir of allDirs) {
    if (!seenDirs.has(dir)) {
      proposal[dir] = baseClusters[dir]!;
    }
  }

  return { proposal, repaired };
}

/** Pass B — clustering via directory merges. See analyze.md#2. */
export async function runPassB(options: RunPassBOptions): Promise<PassBResult> {
  const { files, oneLiners, edges, provider, repoContext } = options;
  const prompt = passBPrompt(files, oneLiners, edges, repoContext);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "pass B",
    schema: PassBResponseSchema,
    context: { callMeta: { pass: "B" } },
  });

  const baseClusters = directoryClusters(files);
  const { proposal, repaired: mergeRepaired } = applyDirectoryMerges(baseClusters, response.merges);

  // Safety-net repair: ensure the merged proposal covers all files exactly once
  const { clusters, repaired: checkRepaired } = checkAndRepairClusters(proposal, files);
  const repaired = mergeRepaired || checkRepaired;

  return {
    clusters,
    repaired,
    modularity: modularity(clusters, edges),
    directoryModularity: modularity(directoryClusters(files), edges),
  };
}
