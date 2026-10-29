# semantic_viz

## General Rules
- Clearly articulate the idea and intent; be terse and omit needless words
- No narration, filler, or detailed thinking output
- Report only actual steps: decisions, implementation, key tool calls (file, command)

**Stack:** TypeScript · Fastify · SQLite

**Structure:** npm-workspace monorepo — `/packages/*` (each with its own `src/` and `test/`) · `/docs` · `/fixtures`

## Commands (always use npm commands - never bare executables)
```
npm run dev
npm run build
npm run test
npm run lint
```
**Deps:** `npm install <pkg>` / `npm install --save-dev <pkg>` · `npm install` to restore

## Critical Rules
- TDD RED-GREEN-REFACTOR is mandatory for behavior changes; exempt non-behavioral work when appropriate.
- Never hardcode secrets, keys, passwords, or credential-like placeholders in code or comments; generate test values or inject them at runtime.
- Never inspect, edit, or commit `.env`; use `.env.example` for shape.
- Never trust raw request data: validate with Zod; DB constraints and domain checks may add validation.

## Code guidelines
- Prioritize correctness > simplicity > readability > consistency > small diffs.
- Avoid unrelated changes; preserve existing user changes.
- Keep functions focused; use abstractions only when necessary.
- Use names that express intent.
- Handle expected error paths explicitly.
- Always remove dead code within the touched scope; do not expand scope for cleanup.
- Do not optimize prematurely.
- Ask when ambiguity could materially change the implementation.
- Before finishing, ensure the change is maintainable and production-ready.

## Git Workflow
**Plan Flow:** branch -> plan -> (review -> fix) loop until approved -> merge PR.
**Code Flow:** always branch → implement → verify → review → push → open PR → (review PR -> fix)loop until approved -> merge PR.
** Never commit or push directly to main.

**Branches:**
- `feature/<name>` — new feature or refactor
- `fix/<short-name>` — bug fix (related fixes may share one branch; unrelated fixes get separate branches)
- `refactor/<name>` — non-functional code change
- Small single-spot fix (<10 lines): ask whether to do a lightweight review or skip the full review loop; never commit directly to main.

## Agent Roles
### Implementer
Writes code, runs the test and lint commands above before considering the task done.

### Reviewer
Reviews as a staff engineer using `project-review` in a fresh sub-session/subagent for the initial review.
Return APPROVED, NEEDS CHANGES, or BLOCKED, with explicit reasons.
Assign one independent reviewer per PR. Persist status and findings across fix iterations until APPROVED.
NEEDS CHANGES and BLOCKED findings require fixes and re-review.
After fixes, re-review the changed scope and affected behavior.

### Security Auditor
Runs `project-security` before merging any change that touches authentication, authorization, secrets, untrusted input, file-system or process execution, database access, or other security boundaries. Reports findings and required fixes.

## Skills
This project ships skills under `.agents/skills/` (the open, cross-tool
SKILL.md standard). `.claude/skills/` is a symlink to that same directory, so
Claude Code sees the identical skills with nothing duplicated. Invoke one
explicitly, or let the agent pick it up automatically when the task matches
its description:

| Skill | Use when |
|---|---|
| `project-security` | Writing auth/security-sensitive code, or asked to audit security |
| `project-review` | Reviewing a branch/PR before merge |
| `project-testing` | Writing or reviewing tests |
| `feature-scaffold` | Adding a new feature end-to-end |

These skills are byproducts of this project. They analyze any codebase and create the data for visualization.

| Skill | Use when |
|---|---|
| `agent-analyze-repo` | Analyzing a whole repo end to end with zero LLM calls (runs the chain below) |
| `agent-analyze-pr` | Updating the committed `.scv/semantics/` store before opening a PR (re-authors only what `scv check --base` reports) |
| `agent-analyze-structure` | Extracting structure and control-flow blocks; the mandatory first step |
| `agent-analyze-functions` | Authoring per-function/class semantics without an LLM pass |
| `agent-analyze-docs` | Authoring README/docs extracts without an LLM pass |
| `agent-analyze-clusters` | Running deterministic clustering after verifying its inputs are narrated |
| `agent-analyze-layers` | Authoring layer/cluster narration without an LLM pass |
| `agent-analyze-groups` | Authoring group narration over real layers without an LLM pass |
| `agent-analyze-flows` | Authoring API flow narration without an LLM pass |

- **Claude Code:** skills in `.claude/skills/` activate automatically when relevant, or ask for one by name ("use the project-security skill").
- **Codex CLI:** skills in `.agents/skills/` activate automatically, or force one with `$project-security` etc.
- **Other SKILL.md-aware agents:** point them at `.agents/skills/<name>/SKILL.md`.

## Agent-Specific Notes
- **Claude Code** reads this file automatically (via its AGENTS.md support), and
  additionally reads `.claude/settings.json` for tool permissions and the
  pre/post-tool-use hooks that back the git-workflow rules above — that file is
  Claude Code-specific and other agents can ignore it.
- **Codex CLI** reads this file automatically. There's no per-repo permissions
  file to write for it; instead run it with an explicit sandbox/approval mode,
  e.g. `codex --sandbox workspace-write --ask-for-approval on-request`.
- **Everyone else** (Cursor, Copilot, Gemini CLI, Windsurf, Zed, Aider, ...):
  this file and `.agents/skills/` follow the open conventions those tools read
  natively — no extra setup needed.

## Project Spec
See `docs/spec/mission.md`, `docs/spec/tech-stack.md`, and `docs/spec/roadmap.md`
for project intent, stack choices, and current status — read these first when
landing cold in the repo.

## Architecture
See `docs/design.md` for design/architecture decisions.

## scv semantics

Before opening a PR, run the `agent-analyze-pr` skill.
