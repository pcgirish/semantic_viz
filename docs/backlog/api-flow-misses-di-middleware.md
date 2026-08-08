# API Flow misses framework DI/middleware steps

**Status:** open
**Found:** 2026-08-08

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

## Fix direction
Pass C's flow-step tracer needs to recognize common DI/middleware
attachment idioms (starting with FastAPI's `Depends()` on routers/routes)
as flow steps, not just direct calls from the handler body. Likely needs a
per-framework (or heuristic AST) pattern for "things that run before this
handler" distinct from "things this handler calls."

## Affected
- `packages/analyze` Pass C (API flow step derivation)
- Surfaced in `packages/ui/src/Flows.tsx` (steps rendering)
