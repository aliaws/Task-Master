# Sample data (dev / staging)

SQL scripts to seed realistic **tags**, **task–tag links**, and **task assignees** after you have tasks and auth users from GHL sync.

Run in the Supabase SQL editor (or `psql`) in order:

1. `01_tags_catalog.sql` — tag names in `public.tags`
2. `02_assign_tasks_and_tags.sql` — `task_tags` links + `tasks.assigned_to` from `auth.users`

**Before running `02`:**

- You need rows in `public.tasks` and `public.contacts` (from sync).
- `02` picks assignees by **email** — edit the `sample_assignees` CTE if your team emails differ.
- Safe to re-run: uses `ON CONFLICT` / idempotent updates where possible.

**Not deployed** — these files are for local/staging use only.
