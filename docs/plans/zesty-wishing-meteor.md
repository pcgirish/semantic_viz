# Plan: Clean up tracked build artifacts before implementation

## Context
Scaffold (PR #2) is merged to `main`, verified: `npm test` and `npm run lint` pass clean.
One issue found: `packages/schema/dist/index.js`, `dist/index.d.ts`, and `tsconfig.tsbuildinfo`
are tracked in git, even though `.gitignore` already excludes `dist/` and `*.tsbuildinfo`.
These are build outputs, not source — they must not be committed (breaks clean-build
reproducibility, causes noisy diffs on every `tsc -b`). Removing them is required before
implementation starts so the first real feature branch doesn't inherit stale build output.

## Change
1. Branch: `git checkout -b fix/untrack-build-artifacts`
2. `git rm --cached packages/schema/dist/index.js packages/schema/dist/index.d.ts packages/schema/tsconfig.tsbuildinfo`
3. Commit: `chore: untrack build artifacts (dist/, tsbuildinfo)`
4. Stop here — no push, no PR, no merge this turn.

## Verification
- `git status` shows the two `dist/` files and `tsbuildinfo` removed, working tree otherwise clean.
- `npm test` and `npm run lint` still pass.
