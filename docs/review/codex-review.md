# Codex Project Review

Date: 2026-08-04  
Scope: entire repository at `main` (`dc4fe57`)  
Verdict: **BLOCKED**

The project is well covered by unit and integration tests, but the review found blocking security and correctness issues at the server/filesystem boundary and in risk scoring. Do not merge or release until the blocking findings are addressed.

## Verification

- `npm test` — passed: 63 test files, 507 tests.
- `npm run lint` — passed.
- `npm run build` — passed.
- `git diff --check main...HEAD` — passed; no branch diff was present.
- `npm audit --omit=dev` — failed with 6 high-severity production dependency findings. Remediation requires a breaking Fastify upgrade according to npm audit.
- No commit or push was performed.

## Blocking findings

### 1. HIGH — Layout and delta routes allow path traversal and unauthenticated filesystem mutation

`packages/server/src/app.ts:34-48` passes route parameters and the request body directly to `SnapshotStore`. `packages/server/src/store.ts:98-119` interpolates `from`, `to`, `sha`, and `skin` into filesystem paths without an allowlist or containment check. The PUT route also has no runtime body validation and no authentication.

Impact: a crafted local request can read parseable JSON outside the intended data directory or overwrite files through `/api/layout`. The bundled server listens on `127.0.0.1`, which limits remote exposure but does not protect against other local processes; `buildApp` itself has no such boundary.

Required fix: validate route parameters with strict schemas (SHA format and skin allowlist), resolve and verify paths remain inside their intended directory, validate `Layout` with Zod including finite values and size limits, and either authenticate the mutating endpoint or remove it from the public API.

### 2. HIGH — Analyzer follows symlinks outside the repository and can send external files to a cloud provider

`packages/extractor/src/host.ts:16-23` and `packages/extractor/src/manifest.ts:22-30` use `statSync`, which follows symlinked directories. `packages/cli/src/analyze.ts:37-40` then reads source by path for Interpreter prompts. With the Anthropic provider, those contents are sent externally (`packages/interpreter/src/providers/anthropic.ts:32-45`).

Impact: analyzing an untrusted or merely symlink-containing repository can traverse outside the requested root and disclose external source or secrets to the selected provider.

Required fix: use `lstat`/realpath containment checks, skip symlinks by default, and add regression tests for symlinked files and directories. Make external-provider disclosure explicit at the CLI boundary.

### 3. HIGH — Dependency audit reports six high-severity production vulnerabilities

`npm audit --omit=dev` reports vulnerable transitive dependencies under `fastify@4.29.1`, including `fast-uri` path traversal/host-confusion advisories and `find-my-way` HTTP/2 DoS exposure. The available audit fix upgrades to Fastify 5, a breaking change.

Required fix: upgrade and test the Fastify major version, or document and mitigate the exposure while the migration is completed. Re-run the audit as part of CI.

### 4. HIGH — LLM risk can undercut the documented deterministic risk floor

The design contract says the formula is a floor and the Interpreter may only raise it (`docs/design.md:175-181`). `packages/differ/src/diff-with-risk.ts:48-57` replaces `risk.score` with Pass D’s score without applying `Math.max(passD.score, delta.risk.formula_floor)`.

Impact: a low-confidence or incorrect model response can lower a change’s displayed risk below the arithmetic baseline and distort the inspect queue. The current test at `packages/differ/test/diff-with-risk.test.ts:56-75` asserts an override but does not assert floor preservation.

Required fix: enforce the floor in code and add a test where Pass D returns a score below it.

### 5. HIGH — Runtime input validation is bypassed at file and HTTP boundaries

The Zod schemas exist in `packages/schema/src/index.ts`, but they are not applied when data enters the server or CLI. `packages/server/src/store.ts:44-46` casts parsed snapshot JSON, and `packages/cli/src/diff.ts:20-25` does the same for snapshots. A malformed snapshot can make `/api/revs` throw during `readAll`; malformed data is otherwise served or diffed as if valid. The layout request body is similarly only a TypeScript compile-time type.

Required fix: parse `SnapshotSchema`/`DeltaSchema` at ingestion, return controlled errors, isolate or reject corrupt files, and use a Zod route/body schema for every Fastify boundary.

## Non-blocking findings and suggestions

- `packages/differ/src/diff.ts:178` computes rollups from `unitsB` whenever the head has any units. Removed units that exist only in `a` are therefore absent from ancestor rollups. Add a removed-child regression test and compute rollups over the relevant old and new trees.
- `packages/interpreter/src/log.ts:17-18` logs complete prompts and responses at `info`; prompts include repository source. Redact or truncate content and make sensitive logging an explicit opt-in with a warning.
- Provider calls in `packages/interpreter/src/providers/*.ts` have no request timeout or cancellation. A stalled Ollama/Anthropic request can hang analysis indefinitely; add bounded timeouts and retry classification.
- `docs/implement-serve.md` documents `/api/delta/:from/:to/queue`, a static SPA served by Fastify, and a SQLite search index, but the current server implements none of those three behaviors. Either implement them or update the contract docs.
- No coverage threshold is configured. The suite has strong happy-path coverage, but server tests lack validation-failure, traversal, malformed-file, and authorization cases; the testing checklist also requires auth-failure coverage for protected endpoints.

## Security checklist

- No tracked secrets, private keys, or `.env` files were found; `.env` is ignored.
- The SQLite cache uses parameterized queries; no raw SQL with user input or hard-delete operation was found.
- React-rendered dynamic text is escaped, but the server sets no CSP and has no authentication layer.
- Primary gaps are filesystem path validation, symlink containment, runtime schema validation, and dependency remediation.
