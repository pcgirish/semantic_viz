---
name: agent-analyze-flows
description: Author narration (name/route + what/how/when/where/why) for API flows and inject it into scv's artifact cache with zero LLM/provider calls. Use when asked to describe a repo's request flows without running scv's real Pass C flow pass.
---

# Agent-authored API flow narration

A flow is one entry-point function plus the call chain traced from it. The
**trace itself is fully deterministic** — `scv` computes the steps, the
dependency-injection prefix and the branch labels from real extraction data
using the same helpers the real pipeline uses. Only the narration normally
needs an LLM, and that is what you write here.

You therefore choose the *entry point*, not the steps.

## Required artifacts

None strictly. `merge-semantics --with-flows` uses the `functions` artifact
from a prior `scv analyze <root> functions` run when one exists, and falls
back to the live structural snapshot when none has ever been written — a
plain `--no-llm` state is legitimate, not an error. Running `functions` first
is still worth it: it gives real unit ids and per-unit semantics to reference.

A persisted-but-**stale** `functions` artifact is refused rather than traced
against.

## Procedure

1. Run `scv analyze <root> functions` (or `scv analyze --no-llm <root>`) to
   get real unit ids. Route handlers are the natural entry points; structural
   route hints live on the extraction graph's `routes`.
2. Write entries into the pending file's `flows` map, keyed by any local id:

   ```json
   {
     "flows": {
       "create-order": {
         "name": "Create order",
         "route": "POST /orders",
         "entryUnit": "u:src.orders.create_order.create_order",
         "tags": ["api"],
         "what": "Creates a new order from a validated request",
         "how": "Authenticates, validates the payload, prices it, then persists",
         "when": "On POST /orders",
         "where": "src/orders/create_order.py",
         "why": "Primary checkout entry point",
         "confidence": 0.85
       }
     }
   }
   ```

   `entryUnit` must be a **real, non-test leaf unit id** — a `function` or a
   `class`. Classes are accepted because class-based route handlers (Django
   CBVs, Flask `MethodView`, DRF `APIView`) are legitimate entry points, and
   because this is exactly the candidate set the real Pass C proposes entry
   points from. Use
   `.scv/pending/<sha>/semantics-flows.json` by convention — one file per
   skill. `merge-semantics` accepts any path and does not check it against
   the sha being merged.
3. Run:

   ```sh
   scv merge-semantics <pending-file> [root] --with-flows
   ```

4. A subsequent `scv analyze <root>` reuses the merged `flows` artifact — no
   provider call for the narrated flows.

## Constraints and failure behavior

Failures are per entry: a bad entry is skipped with a warning, the rest merge.

- `entryUnit` that is not a real, non-test leaf (`function` or `class`) unit
  → skipped. A module or an already-derived unit (layer, group, flow) is not
  an eligible entry point.
- An entry whose trace yields fewer than two steps → skipped, matching what
  the real pass considers too short to be a flow.
- Two entries resolving to the same flow id (same route and same traced
  steps) → the first is kept, the rest skipped.
- **Historical `--sha` merges are not supported.** Flow merging requires live
  extraction: a persisted snapshot carries no dependency-injection edges and
  no block graph, so a flow merged from one would have an empty DI prefix and
  no branch labels — silently different from the real pipeline's output.
  The merge errors rather than producing that.

## Related

`agent-analyze-functions` for the per-unit semantics these flows step
through, `agent-analyze-layers` and `agent-analyze-groups` for the structural
tiers above them.
