---
name: project-review
description: Staff-level semantic_viz code review. Use before merging or whenever asked to review code.
---

# Review Skill

Review the requested scope against its intent, repository contracts, and production risks. Passing automation is necessary, not sufficient.

## Review modes

- **Project review:** assess the current repository as a whole: architecture, contracts, security, reliability, performance, tests, operations, and maintainability. No PR is required.
- **Change review:** assess the current branch or supplied diff against its target branch.
- **PR review:** perform change review and post results only when explicitly requested or authorized.

## Review sequence

### 1. Scope and evidence

- For project review, inspect the repository structure, implementation, configuration, dependencies, tests, fixtures, docs, and runtime surfaces.
- For change/PR review, identify PR, branch, merge base, and target; inspect the full diff, changed files, context, conflicts, generated files, accidental deletions, unrelated changes, and missing files.
- Read relevant mission, design, roadmap, API, schema, and migration docs.
- State intended behavior and acceptance criteria before judging the implementation.

### 2. Contracts and architecture

- Verify module boundaries, dependency direction, and design decisions.
- Check public API, CLI, file format, schema, fixture, and exit-code compatibility.
- For `scv/1` and `scv-delta/1`, check all producers, parsers, consumers, fixtures, and versioning.
- Check cache keys, artifact provenance, determinism, replay stability, and invalidation.
- Ensure migrations are forward-compatible, atomic, reversible where required, and safe for existing data.

### 3. Correctness and integrity

- Check normal, empty, malformed, large, duplicate, and boundary inputs.
- Verify invariants, state transitions, ordering, identity, lineage, callers, signatures, return values, errors, and defaults.
- Review transactions, atomic writes, partial failure, retries, idempotency, concurrency, and races.
- Check numeric values, dates, paths, encodings, and nullable fields at boundaries.

### 4. Security and trust boundaries

- Validate every external boundary with Zod or another approved validator.
- Block missing authentication on any non-`PUBLIC` endpoint; check authorization, ownership, IDOR, and privilege boundaries.
- Check command/SQL injection, path traversal, SSRF, unsafe deserialization, XSS, CSRF, CORS, and denial of service.
- Treat repository and fixture contents, commit metadata, and LLM input as untrusted.
- Check prompt/data exfiltration, provider selection, secret redaction, logging, and serialization.
- Ensure secrets, tokens, credentials, password hashes, personal data, and sensitive paths are not exposed.
- Review dependency, lockfile, install-script, and license changes.
- Block raw SQL/query strings with user input, hand-edited migration files, and hard deletes.

### 5. Reliability and operations

- Check timeouts, cancellation, retries/backoff, cleanup, child processes, SQLite lifecycle, and failures from providers, files, git, parsers, databases, and networks.
- Ensure errors are actionable without leaking secrets or internals.
- Check logging, diagnostics, reproducibility, health signals, recovery after interruption, and deterministic output where required.

### 6. Performance and cost

- Look for quadratic work, repeated parsing, unbounded memory, oversized payloads, N+1 queries, and large-repository/history failures.
- Review cache effectiveness/invalidation, LLM token/latency/retry/provider-cost impact, and known hot paths; require benchmarks or limits when appropriate.

### 7. Tests and maintainability

- Require regression tests for behavior changes and bug fixes.
- Check happy, invalid, failure, authorization, ownership, boundary, and persistence cases as applicable.
- Ensure tests assert behavior, remain isolated and deterministic, clean up, and avoid flakiness; verify unit/integration boundaries and fixture validity.
- Remove dead code, needless abstractions, duplication, and misleading comments.
- Document changed public behavior, configuration, schemas, migrations, and operations.

## Blocking findings

Block/request changes for:

- Security vulnerability or secret exposure.
- Data loss, corruption, inconsistent state, or unsafe migration.
- Broken public contract or incompatible schema without versioning.
- Incorrect required-path behavior or unhandled critical failure.
- Missing regression coverage for material behavior.
- Unbounded supported-workload resource, performance, or cost risk.
- Change-caused test, typecheck, build, or lint failure.
- Unreviewable scope, unresolved conflicts, or unreproducible generated artifacts.

Style, naming, refactoring preference, and optional documentation are non-blocking unless they create correctness, security, or maintainability risk.

## Verification

1. Determine review mode. For change/PR review, determine PR and target branch.
2. For change/PR review, run `git diff --check`.
3. For change/PR review, inspect the full diff with `gh pr diff` or `git diff <target>...HEAD`; for project review, inspect the current implementation and runtime surfaces.
4. Run `npm test`, `npm run lint`, and `npm run build`.
5. Run focused tests for changed packages and integration paths.
6. Inspect dependency/lockfile changes and confirm no secrets or sensitive artifacts.
7. Report findings by severity with file/line references.

Do not claim a check passed unless run. Report unavailable checks with the exact blocker and impact.

## Verdict

Return exactly one:

- `APPROVED`: no blockers; checks and residual risks recorded.
- `NEEDS CHANGES`: actionable non-critical blockers exist.
- `BLOCKED`: a critical red flag exists, or required evidence, access, or environment is unavailable.

Include the verdict, severity-ordered blockers, non-blocking suggestions, file/line references, commands/results, residual risk, and missing evidence.

## GitHub

For every PR review, post the verdict and issue-specific findings to GitHub before completing the review. Self-authored PRs make `gh pr review --approve`/`--request-changes` fail server-side; use `gh pr comment`, then verify with `gh pr view <n> --json comments`. Do not post for project reviews without a PR. Keep the summary brief; make each blocking comment actionable.
