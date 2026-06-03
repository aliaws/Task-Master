# Task-Master — GHL Sync & Tasks API

Supabase Edge Functions for GoHighLevel sync and task board APIs. Sync checkpoints in `sync_checkpoints` use `last_cursor` to resume.

## Database ID types

| Table / column | Type |
|----------------|------|
| `tasks.id` | integer (PK) |
| `task_boards.id` / `tasks.status_id` | integer |
| `contacts.id` / `tasks.contact_id` | UUID |
| `tags.id` / `task_tags.tag_id` | integer |
| `task_tags.task_id` | integer → `tasks.id` |
| `tasks.assigned_to` | UUID (Supabase Auth user, from sync) |
| `tasks.data_source` | string (origin of the task row; returned on `list` and `kanban`) |

Apply tags schema once:

```bash
supabase db push
# or run supabase/migrations/20260520120000_tags.sql
```

After task import, seed tag catalog and links:

```sql
SELECT * FROM public.sync_tags_from_tasks();
```

---

## Deploy

### sync-ghl

Source: `edge-functions/sync-ghl/`

```
edge-functions/sync-ghl/
├── index.js
├── sync-constants.js
├── sync-ghl-contact-core.js
├── sync-ghl-tasks-core.js
├── sync-ghl-users-core.js
├── sync-ghl-tasks-list-core.js
├── sync-ghl-task-boards.js
└── task_list.js              # bundled TASK_LIST for ?sync=tasks_list
```

```bash
supabase functions deploy sync-ghl
```

### tasks

Source: `edge-functions/tasks/` — one function, multiple actions via `action` in the body.

```
edge-functions/tasks/
├── index.js              # POST router (?action= or body.action)
├── kanban-action.js      # action: kanban — board columns
├── list.js               # action: list — flat paginated list
├── task-detail.js
├── boards-action.js
├── tags-action.js
├── contacts-action.js    # action: contacts — lookup / autocomplete
├── users-action.js       # action: users — assignee lookup
├── lookup-utils.js
├── search-utils.js       # shared ILIKE / search operators
├── query.js              # list filters + SQL
├── utils.js
└── db.js
```

```bash
supabase functions deploy tasks
```

Requires **`SUPABASE_DB_URL`** on the function.

**CORS:** Responses include `Access-Control-Allow-Origin: *` and allowed headers (`authorization`, `x-client-info`, `apikey`, `content-type`, `x-api-key`). Send **`OPTIONS`** for preflight; **`POST`** for all actions (same pattern as `password-validate-send-otp`).

**API reference:** [docs/TASKS_API.md](docs/TASKS_API.md)

| Action | Purpose |
|--------|---------|
| `kanban` | Tasks grouped by `task_boards.name` (default); `assigned_to`, `time_spent`, `data_source` per task |
| `list` | Paginated list; filters: `status`, `priority`, `assign`, `contacts`, `due`, `completed`, `title` + `title_match`; `assigned_to`, `time_spent`, `data_source` |
| `task_detail` | One task by integer `id`; subtasks, attachments, tags, `time_spent` (same as kanban) |
| `boards` | Integer `task_boards.id` for filter dropdowns |
| `tags` | Autocomplete via `search_tags()` |
| `contacts` | Contact lookup: autocomplete or `search_column` + `search_operator` |
| `users` | Assignee lookup (`auth.users`): same filter modes as `contacts` |

Example:

```
POST https://{{Supabase_ID}}.supabase.co/functions/v1/tasks
{ "action": "list", "page": 1, "limit": 20, "sort_by": "created_at", "order": "DESC" }
```

**Sample data** (tags, assignees, optional contacts): [sample-data/](sample-data/)

---

## Recommended sync order (fresh project)

1. `?sync=contacts`
2. `?sync=users`
3. `?sync=tasks_list` or `?sync=tasks`
4. `SELECT * FROM public.sync_tags_from_tasks();` (optional)
5. Use `tasks` API for UI

---

## sync-ghl API

```
https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl
```

| Query | Action |
|-------|--------|
| `?sync=contacts` | GHL contacts → `contacts` |
| `?sync=tasks` | GHL tasks per contact → `tasks` |
| `?sync=users` | GHL users → Supabase Auth |
| `?sync=tasks_list` | `task_list.js` → `tasks` (no GHL API) |
| `?sync=all` | contacts then tasks (default) |

Supports **GET** and **POST**.

### Checkpoint keys

| `sync_checkpoints.key` | `last_cursor` |
|------------------------|---------------|
| `ghl_contact_sync` | GHL `searchAfter` JSON |
| `ghl_task_sync` | Last processed `contacts.id` |

Reset:

```sql
UPDATE sync_checkpoints
SET last_cursor = NULL, total_saved_contacts = 0, total_available_contacts = 0
WHERE key = 'ghl_contact_sync';

UPDATE sync_checkpoints
SET last_cursor = NULL, total_contacts_processed = 0, total_saved_tasks = 0
WHERE key = 'ghl_task_sync';
```

### Task status mapping

`status_id` comes from `task_boards` (`is_completed` → completed vs open board).

---

## Environment

On Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` (required for **tasks**)

RPCs: `get_token_health`, `get_vault_secrets`.

---

## Other edge functions

| File | Notes |
|------|--------|
| `password-validate-send-otp.ts` | Hono; password check + OTP send/verify; CORS + `x-api-key` |
| `refresh-token.js`, `task-timer.js` | Deploy separately if used |
| `sync-task-ghl-localy.js` | Local only, not deployed |
