# API Flow misses framework DI/middleware steps

**Status:** closed
**Found:** 2026-08-08
**Closed:** 2026-08-08 — landed alongside API Flow branch-preserving tracing (see `docs/design.md`).

## Problem
API Flow mode's steps are derived (Pass C) by tracing the route handler's own
function-call graph. Middleware or dependencies wired via framework DI —
e.g. FastAPI's `APIRouter(dependencies=[Depends(...)])` — execute on every
request but are never called from the handler body, so the tracer misses
them entirely.

Confirmed on the `orderly` fixture: `src/api/routes.py` wires
`rate_limit("public")` and `verify_token` as router-level `Depends()`:

```python
public = APIRouter(prefix="/public",
                   dependencies=[Depends(rate_limit("public")), Depends(verify_token)])
```

Real snapshot's `api_flow` units (`u:flow:66bb89cb` "Create Order",
`u:flow:f1bcfb51` "Get Order") list only the direct call chain
(`create_order` → `repo.*` → `db.connection.*`) — `rate_limit` and
`verify_token` are absent from `steps`, even though they guard every
request.

(`docs/mock/codedream-ui-mock.html`'s API Flow demo shows `rate_limit` as a
step, but that's hand-authored fixture data, not derived — not a real
behavior to match.)

## Fix
`packages/extractor/src/walk-python.ts` now extracts `APIRouter(dependencies=[Depends(...)])`
(`DiRouterFact`) and route registrations in both call-form (`router.post(path)(handler)`) and
decorator-form (`@router.get(path)` above a `def`) (`RouteRegistrationFact`).
`packages/extractor/src/resolve.ts` joins these per-file into synthetic `calls` edges tagged
`via: "di"` from each handler to its router's dependencies. `packages/interpreter/src/orchestrate.ts`
reads these from the raw `SymbolGraph` (schema's `Edge` type doesn't carry `via`) and splices
them in as a linear prefix ahead of the handler's own traced steps, in both `steps` and
`stepsBranching`.

## Affected
- `packages/extractor` (DI/route-registration fact extraction + edge resolution)
- `packages/interpreter` Pass C (API flow step derivation, `orchestrate.ts`)
- Surfaced in `packages/ui/src/Flows.tsx` (steps rendering)
