---
name: agent-narrate-layers
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
   paths are real. If you want to see the real clustering first, run
   `scv analyze <root> layers --no-llm` is not sufficient (clustering needs
   `--with-clustering` in the merge step below, not a separate analyze
   flag) — instead just proceed to step 2 with your own understanding of
   which files group together.
2. For each cluster you want to narrate, write an entry into the pending
   file's `layers` map, keyed by any local id you choose (only `files` is
   used to match it against the real cluster):

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
   that doesn't match any real cluster is skipped with a warning.
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
- To also narrate individual functions/classes, use the
  `agent-write-pass-a-semantics` skill.
