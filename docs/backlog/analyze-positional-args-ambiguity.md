# `scv analyze` positional args are ambiguous

**Status:** closed (2026-10-29) — resolved by rejecting the ambiguity; see Resolution
**Found:** 2026-08-26

## Problem
`scv analyze` takes two optional positionals, in this order:

```
scv analyze [root] [artifact]
```

where `[root]` defaults to `.` and `[artifact]` is one of
`functions | docs | clusters | layers | groups | flows`
(`packages/cli/src/bin.ts:18-19`).

Because `[root]` comes first and both are optional, a single-argument
invocation is always parsed as the **root**, never the artifact:

```sh
scv analyze functions     # root = ./functions, artifact = undefined
scv analyze . functions   # root = ., artifact = functions   <- intended
```

This is silent when a directory of that name exists. Observed in the wild:
a repo containing an `eq_to_word_problem/functions/` folder, where
`scv analyze functions` analyzed that subfolder structurally and wrote a
snapshot for it. No `functions.json` artifact appeared under the sha the
user was inspecting, and no LLM narration ran for the intended scope — with
no error, because every step genuinely succeeded on the folder it was
actually given.

Every artifact name is a plausible directory name (`functions`, `docs`,
`layers`, `groups`, `flows`), and `docs/` in particular exists in this very
repo — so the failure is not exotic.

## Why this needs thought, not a quick patch
The obvious fixes each have a real cost, and the choice is a UX/compat
decision rather than a bug fix:

- **Disambiguate by filesystem probe** — treat a lone arg matching an
  artifact name as the artifact *unless* a directory of that name exists.
  Fixes the common case but makes the meaning of a command depend on the
  working directory's contents, which is its own trap (the same command
  means different things in different repos).
- **Make the artifact a flag** (`--artifact functions` / `--only functions`)
  — unambiguous and self-documenting, but breaks the existing positional
  form, including the `[WARN] ... run 'scv analyze <artifact>'` hint that
  `runAnalyze` itself prints (`bin.ts:51`), which today emits the
  ambiguous single-arg form and would need updating regardless.
- **Require both positionals** whenever an artifact is named — smallest
  change, but leaves the footgun for anyone who omits the root.
- **Warn on ambiguity** — always emit a notice when a lone arg matches an
  artifact name and also resolves to a directory. Cheap, additive, and
  compatible with any of the above as an interim step.

Note the warning hint at `bin.ts:51` is itself affected: it currently
suggests `scv analyze functions`, which is precisely the ambiguous form
that triggered this report.

## Affected
- `packages/cli/src/bin.ts` (argument definition and the `emptyArtifacts` hint)
- `packages/cli/test/bin.test.ts` (argument-parsing coverage)
- `.agents/skills/agent-analyze-*/SKILL.md` (any documented invocations)

## Resolution
Chose **reject the ambiguity**. A lone argument that is an artifact name now
fails before any work, naming both explicit forms:

```
error: "functions" is ambiguous: it is an artifact name, but a single argument is read as the repo root to analyze.
  to compute the functions artifact of the current repo:  scv analyze . functions
  to analyze the directory ./functions as a repo:          scv analyze ./functions
```

The meaning never depends on which directories exist. The `[WARN] ... run
'scv analyze ...'` hint now prints the root it was given
(`scv analyze . layers`), so it no longer suggests the ambiguous form.
