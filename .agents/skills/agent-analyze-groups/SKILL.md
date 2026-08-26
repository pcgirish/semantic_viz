---
name: agent-analyze-groups
description: Author narration (name + what/how/when/where/why) for groups of architectural layers and inject it into scv's artifact cache with zero LLM/provider calls. Use when asked to group and describe a repo's layers without running scv's real Pass C grouping.
---

# Agent-authored group narration

Groups are the tier between the system and its layers: each group owns a set
of layers. `scv merge-semantics --with-groups` resolves the layer *names* you
write to real layer ids, builds the group units the same way the real pipeline
does, and attaches your narration to them.

This is a deliberate, scoped exception to the real Pass C, which still ships
groups with `semantics: null` by design — it produces memberships and a name,
not prose, and deriving prose by concatenating member layers would produce
text no human wrote and no model endorsed. A real group-narration LLM pass is
separate future work; this agent-authored path is not blocked on it and
diverges intentionally.

## Required artifacts

A **fresh `layers` artifact** must exist before merging — groups are built on
top of real layers, not proposed ones:

```sh
scv analyze <root> layers
```

Freshness is checked transitively, so a stale `clusters`, `functions` or
`extraction` anywhere below `layers` fails the merge with an actionable error
rather than grouping against outdated layer data. If you are producing layers
via the zero-LLM path, run `agent-analyze-layers` first.

## Procedure

1. Read the real layer names from `.scv/artifacts/<sha>/layers.json` (or a
   real snapshot's layer units). Group membership is written by **layer name**,
   and every name you reference must match exactly one real layer.
2. Write entries into the pending file's `groups` map, keyed by any local id
   you choose:

   ```json
   {
     "groups": {
       "core": {
         "name": "Order Core",
         "layers": ["Orders", "Pricing"],
         "what": "Order lifecycle and pricing rules",
         "how": "Validates and prices orders, then persists them",
         "when": "On every order-related API call",
         "where": "src/orders/, src/pricing/",
         "why": "Keeps the business rules that change together in one place",
         "confidence": 0.85
       }
     }
   }
   ```

   Use `.scv/pending/<sha>/semantics-groups.json` by convention — one file per
   skill, never split across several. `merge-semantics` accepts any path and
   does not check that it matches the sha being merged.
3. Run:

   ```sh
   scv merge-semantics <pending-file> [root] --with-groups
   ```

4. A subsequent `scv analyze <root>` reuses the merged `groups` artifact — no
   provider call for the narrated groups.

## Constraints and failure behavior

Failures are **per entry**: one bad entry is skipped with a warning and every
other valid entry still merges.

- A layer name that matches no real layer, or is ambiguous (two real layers
  share it), skips that whole entry.
- Listing the same layer twice within one entry's `layers` skips that entry.
- Two entries claiming the same layer: the first merges, the second is
  skipped.
- Two entries with the same `name`: **both** are skipped, since the group name
  is the identity the built units are keyed by.
- Any layer no pending group claims lands automatically in an "Ungrouped"
  bucket, which is never narrated and keeps `semantics: null`.

Matching is by resolved member-layer set, not by your pending key and not by
group name — so you are free to rename a group without breaking the merge.

## Related

`agent-analyze-layers` for the layers these groups are built on,
`agent-analyze-functions` for per-unit semantics, `agent-analyze-flows` for
API flows.
