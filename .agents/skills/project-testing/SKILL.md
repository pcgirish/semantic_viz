---
name: project-testing
description: semantic_viz test-writing skill — coverage requirements (happy path, auth fail, validation fail, ownership), unit vs integration layout, conventions. Use when writing or reviewing tests in this repo.
---

# Testing Skill

Use when writing or reviewing tests.

## Coverage Requirements
Every new endpoint needs at minimum:
1. Happy path (200/201 response, correct shape)
2. Auth failure (401 when token missing or invalid)
3. Validation failure (422/400 when required fields missing)

## Conventions
- Use beforeEach/afterEach for setup/teardown — never share state between tests
- Unit tests: /tests/unit/ — pure functions with mocked dependencies
- Integration tests: /tests/integration/ — full HTTP via supertest
- Test file mirrors source: src/routes/users.ts → tests/unit/users.test.ts

## What NOT to test
- Framework internals (Express / NestJS)
- Zod / class-validator schema rules themselves
- Third-party library behaviour

Run before every commit: `npm test`
