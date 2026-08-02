---
name: project-review
description: semantic_viz code-review skill — review order, red-flag list, PR/branch review procedure, and an APPROVED/BLOCKED verdict format. Use before merging a branch or PR in this repo.
---

# Review Skill

Use before merging a branch or PR, or whenever asked to review code.

## Review Order (check in this sequence)
1. Security — auth, input validation, secrets, injection
2. Correctness — does it do what the spec says?
3. Error handling — what happens when things go wrong?
4. Tests — are the right cases covered?
5. Style — linter-clean, readable, consistent with codebase

## Red Flags (block the PR if any are present)
- Secret or credential in code or comment
- Missing auth check on non-PUBLIC endpoint
- Raw SQL / query string with user input
- Password hash returned in response
- Migration file hand-edited
- Hard DELETE instead of soft delete

## Review Procedure
1. Run `gh pr diff` (or `git diff main...HEAD` if no PR yet) to see all changes
2. Verify no secrets or hardcoded values anywhere
3. Run `npm test` — report any failures
4. Run `npm run lint` — report any lint errors
5. Summarise: what changed, risk level, what is missing tests

## Output Format
- APPROVED / BLOCKED / NEEDS CHANGES verdict
- List of blocking issues (if any)
- List of suggestions (non-blocking)
- Confirmation that `npm test` and `npm run lint` pass

## Posting to GitHub
If there is an open PR for the branch, post the verdict there — a review that only exists in chat is invisible to anyone else looking at the PR.

**This repo's PRs are always self-authored by the same `gh` identity that reviews them, so `gh pr review --approve`/`--request-changes` always fails server-side ("Can not approve your own pull request"). Do not attempt it — go straight to `gh pr comment`.**

- **APPROVED**: `gh pr comment <n> --body "<verdict: APPROVED><2-4 sentence summary: what changed, what was checked, any non-blocking suggestions>"`
- **NEEDS CHANGES**: `gh pr comment <n> --body "<verdict: NEEDS CHANGES><summary>"`, then one more `gh pr comment <n> --body "..."` (or inline via `gh api`) per blocking issue, specific enough to act on (file, line, what's wrong).
- **BLOCKED**: same as NEEDS CHANGES, and call out explicitly that this is a red-flag block, not a style nit.
Keep the summary comment brief; put detail in issue-specific comments, not a wall of text on one comment.

**Verify the post landed.** Confirm with `gh pr view <n> --json comments` that the comment actually appears. Never end a review by only reporting the verdict in chat; the GitHub-visible record is the deliverable, not the chat message.
