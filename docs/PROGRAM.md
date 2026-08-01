# Architecture Decisions — semantic_viz
## Database Conventions

- All models include: `id` (UUID), `created_at`, `updated_at`, `deleted_at`
- **Soft deletes only** — `deleted_at` column; never hard DELETE
- Foreign keys have explicit `ondelete` behaviour defined

## API Conventions

- All routes prefixed `/api/v1/`
- Error format: `{ "error": "SHORT_CODE", "detail": "human message" }`
- Paginated responses: `{ "items": [], "total": int, "page": int, "size": int }`

> Testing conventions: see the `project-testing` skill in `.agents/skills/`.
