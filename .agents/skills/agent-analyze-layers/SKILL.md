---
name: agent-analyze-layers
description: Author Pass-C-shaped narration (what/how/when/where/why + name) for architectural layers/clusters you already understand, and inject it into scv's artifact cache with zero LLM/provider calls. Use when asked to name/describe a repo's layers without running scv's real LLM narration pass.
---

# Agent-authored layer narration

Pass B (file clustering) is already deterministic and free — no LLM call.
Only Pass C's narration (naming a cluster, describing its purpose) normally
calls an LLM. If you already understand the repo's architecture, you can
write that narration directly; `scv merge-semantics --with-clustering`
re-runs Pass B (still free) to get real cluster membership, matches your
narration to the real clusters by file set, and injects it into the
artifact cache as if a real Pass C had produced it.

## Procedure

1. Run `scv analyze --no-llm <root>` (or reuse an existing run) so file
   paths are real. To see the real clustering first, run
   `scv analyze <root> clusters` (free, no LLM call) and read
   `.scv/artifacts/<sha>/clusters.json` for real `files` sets per group,
   before writing narration.
2. For each cluster you want to narrate, write an entry into the pending
   file's `layers` map, keyed by any local id you choose. `files` must be
   the *exact* file set of a real cluster — read it from a real cluster's
   `files` (see step 1 / Notes) rather than assembling it yourself, since
   real clustering already excludes test and generated paths from cluster
   membership and a `files` set containing one will never match.

   ```json
   {
     "layers": {
       "orders": {
         "name": "Orders",
         "files": ["src/handlers/create_order.py", "src/handlers/cancel_order.py"],
         "what": "Order lifecycle handlers",
         "how": "Validates requests, mutates order state, persists via the repository",
         "when": "On every order-related API call",
         "where": "src/handlers/",
         "why": "Isolates order business rules from transport and persistence concerns",
         "confidence": 0.85
       }
     }
   }
   ```

   `files` must be the *exact* file set of a real cluster — `scv` computes
   the real clustering and matches by that set (via the same id function
   the pipeline uses internally), not by your chosen key. A `files` set
   that doesn't match any real cluster is skipped with a warning. Write all
   entries into a single path: `.scv/pending/<sha>/semantics-layers.json` —
   a file separate from `agent-analyze-functions`'s
   `semantics-functions.json`, never split narration across several files.
   That path is a **convention, not a requirement**: `merge-semantics`
   accepts any file path and never checks that the name or directory
   matches the sha it is merging against.
3. Run:

   ```sh
   scv merge-semantics <pending-file> [root] --with-clustering [--sha <sha>]
   ```

4. A subsequent `scv analyze <root>` reuses the merged `layers` artifact
   (its `inputHash` already matches) — no provider call happens for the
   narrated layers. `groups`/`flows` compute normally on top.

## Notes

- Pass B clustering itself never calls an LLM, with or without this skill —
  only the narration text is agent-authored here.
- Getting a cluster's exact file set right matters: if you're unsure what
  the real clusters look like, run a real `scv analyze <root>` once first
  and read `.scv/snapshots/<sha>.json`'s layer units for their `files`.
- Merging narration for only *some* clusters is safe: any real cluster your
  pending file doesn't mention keeps whatever name/narration/provenance it
  already has in the cached `layers` artifact, rather than being reset to a
  placeholder. Only clusters never narrated at all get `"(no summary)"`.
- Running `agent-analyze-functions` first is optional, not required — the
  manual layer-merge path does not read per-unit function semantics when
  building layer units, so it does not affect `--with-clustering` output.
  It is still worth doing when a *real* Pass C may narrate remaining layers
  later, since that LLM prompt is built from per-unit `semantics.what`.
- To also narrate individual functions/classes, use the
  `agent-analyze-functions` skill; for layer groupings and API flows, see
  `agent-analyze-groups` and `agent-analyze-flows`.
