---
name: feature-scaffold
description: Scaffold a new feature end-to-end following semantic_viz's conventions (schema/model/service/route/tests, wired up and security-checked). Use when asked to add or scaffold a new feature. Ask for the feature name if not given.
---

# Feature Scaffold Skill

1. Define types/interfaces in src/types/<feature>.ts
2. Create service logic in src/services/<feature>.ts
3. Create route handler in src/routes/<feature>.ts with auth middleware
4. Register route in src/app.ts
5. Create test file at tests/integration/<feature>.test.ts
6. Run the `project-security` skill and verify the feature passes all checks
7. Run `npm test` and `npm run lint` — fix any issues before finishing
