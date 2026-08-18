# Wire `scv serve` and `scv ui` into the CLI

## Context
`packages/cli`'s `scv` binary currently wires up `analyze` and `diff` only
(`packages/cli/src/bin.ts`). The Fastify API server (`packages/server`) and
the React UI (`packages/ui`) both exist and work, but must be started by hand
today — `node packages/server/dist/bin.js /path/to/repo` and
`npm run dev --workspace packages/ui` — which only works from inside the
monorepo checkout, not from an installed `scv` package. `docs/implement-serve.md`
and README's Status section already describe/claim `scv serve` as part of the
product; it doesn't exist as a CLI command. This adds it, plus a matching
`scv ui` command for the built SPA, so the "seeing a codebase end to end"
workflow in README collapses from four manual commands to three CLI
subcommands (`analyze`, `serve`, `ui`).

Split into two commands rather than one merged "serve everything" command:
- `scv serve [root]` — thin wrapper around the existing `buildApp`/`listen`
  logic in `packages/server/src/bin.ts`, callable via the `scv` binary
  instead of a separate `node packages/server/dist/bin.js` invocation.
  API-only, same behavior as today.
- `scv ui` — serves the **built** `packages/ui/dist` SPA statically (via
  `@fastify/static`, new dependency), proxying `/api/*` to a running
  `scv serve` process. Requires `npm run build --workspace packages/ui`
  first; no vite/dev toolchain needed at runtime. This is the "static
  preview of dist/" mode, not a vite-dev-server passthrough — an installed
  `scv` package has no monorepo dev dependencies available to shell out to.

## `scv serve`
- New file `packages/cli/src/serve.ts`: exports `runServe({ root, port })`
  that resolves `scvDir = path.join(path.resolve(root), ".scv")`, calls
  `buildApp({ scvDir })` from `@scv/server`, and `.listen({ port, host: "127.0.0.1" })`,
  mirroring `packages/server/src/bin.ts`'s existing logic (import `buildApp`
  from `@scv/server`'s package export rather than duplicating it — check
  `packages/server/src/index.ts` exports `buildApp`; add the export there if
  missing).
- `packages/cli/package.json` gains `@scv/server` as a dependency.
- `bin.ts` gets a new `serve` command: `.argument("[root]", ..., ".")`,
  `.option("--port <n>", ..., default from `process.env.PORT ?? "3000"`)`,
  action calls `runServe` and logs the listening URL — same log line style
  as `packages/server/src/bin.ts` (`serving ${scvDir} on http://127.0.0.1:${port}`).
  Keep `packages/server/src/bin.ts` as-is (still usable standalone); no
  behavior change there.

## `scv ui`
- New file `packages/cli/src/ui.ts`: exports `runUi({ port, apiPort })` that
  builds a small Fastify (or reuse pattern from `@scv/server`) instance,
  registers `@fastify/static` pointed at `packages/ui/dist` (resolve the path
  via `import.meta.resolve` or `require.resolve('@scv/ui/package.json')`-style
  lookup since `packages/ui` isn't installed as a CLI dependency in the
  traditional sense — needs a monorepo-safe way to locate the built dist;
  simplest: `packages/cli` depends on `@scv/ui` as a workspace dependency
  purely so its `dist/` is resolvable via `require.resolve`), a wildcard
  fallback to `index.html` for SPA client-side routing, and a proxy for
  `/api/*` to `http://127.0.0.1:${apiPort}` (use `@fastify/http-proxy`, new
  dependency, rather than hand-rolling proxying).
- `packages/cli/package.json` gains `@scv/ui`, `@fastify/static`,
  `@fastify/http-proxy` as dependencies.
- `bin.ts` gets a new `ui` command: `.option("--port <n>", ..., default "5173"
  or similar, distinct from serve's 3000)`, `.option("--api-port <n>", ...,
  default "3000")`, action calls `runUi`, logs the URL to open.
- Errors clearly if `packages/ui/dist/index.html` doesn't exist yet (e.g.
  "UI not built — run `npm run build --workspace packages/ui` first"),
  rather than a raw ENOENT from fastify-static.

## Tests (TDD RED before implementation, per CLAUDE.md)
- `packages/cli/test/serve.test.ts`: `runServe` starts a listening server on
  the given port serving the given `.scv` dir's API (assert `/api/revs`
  responds via a real HTTP request against a temp `.scv` fixture, reusing
  `packages/server/test/fixtures.ts`'s `writeScvFixture`/`makeSnapshot` if
  importable across packages, or an equivalent local fixture). Close the
  server in test teardown.
- `packages/cli/test/ui.test.ts`: `runUi` serves `index.html` at `/`, serves
  a known static asset from a fixture `dist/` directory, and proxies a
  `/api/*` request through to a stub upstream server. Errors clearly (thrown
  error or rejected promise, not a crash) when the dist directory is missing
  — build a temp `dist/` fixture in the test rather than depending on the
  real `packages/ui/dist` build output being present in CI.
- `packages/cli/test/bin.test.ts` (existing file) — add coverage that `scv
  serve --help` and `scv ui --help` are registered commands (Commander
  exposes them), consistent with existing bin-level tests there.

## Files touched
- `packages/cli/src/serve.ts` — new
- `packages/cli/src/ui.ts` — new
- `packages/cli/src/bin.ts` — add `serve` and `ui` commands
- `packages/cli/package.json` — add `@scv/server`, `@scv/ui`, `@fastify/static`, `@fastify/http-proxy`
- `packages/server/src/index.ts` — export `buildApp` if not already exported (check first)
- `packages/cli/test/serve.test.ts`, `packages/cli/test/ui.test.ts` — new
- `packages/cli/test/bin.test.ts` — extend
- `README.md` — replace the 4-manual-command "Seeing a codebase end to end"
  section (lines ~106-121) with the 3-CLI-command version; update the
  `packages/cli` package-status table row (line 38) to mention `serve`/`ui`;
  update line 246 package-tree comment.
- `docs/implement-serve.md` — note that `scv serve`/`scv ui` are the CLI
  entrypoints for the server/SPA described there, if it doesn't already say so.

## Verification
- `npm run build` (build order matters: `packages/ui` and `packages/server`
  must build before `packages/cli` can resolve their dist output / exports).
- `npm test` — new tests green, no regressions.
- `npm run lint` clean.
- Manual: `npm run build`, then `node packages/cli/dist/bin.js analyze fixtures/orderly`,
  `node packages/cli/dist/bin.js serve fixtures/orderly` in one terminal,
  `node packages/cli/dist/bin.js ui` in another, open the printed URL, confirm
  the tile map loads and `/api/revs` resolves through the proxy.

## Git workflow
Per CLAUDE.md: branch `feature/cli-serve-ui`, TDD RED→GREEN per file above,
verify (test/lint), `project-review` skill in a fresh subagent, push, PR,
post review verdict via `gh pr comment` (self-review blocked on this repo),
merge.
