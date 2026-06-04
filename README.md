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
| `kanban` | Tasks grouped by `task_boards.name` (default); `assigned_to`, `time_spent`, `data_source`, `description_truncated` (optional `description_truncate_length`, default **80**) |
| `list` | Paginated list; filters: `status`, `priority`, `assign`, `contacts`, `due`, `completed`, `title` + `title_match`; `description_truncated` (HTML stripped; optional `description_truncate_length`, default **80**) |
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

### task-timer

Source: `edge-functions/task-timer/index.ts` — record session time and return total `time_spent` for a task.

```bash
supabase functions deploy task-timer
```

Requires **`SUPABASE_DB_URL`**. **CORS:** same as **tasks** (`OPTIONS` preflight, `POST` only).

**Body:** `{ "task_id": 42, "duration_seconds": 120 }` — `duration_seconds` is optional; if omitted, only returns current total.

### refresh-token

Source: `edge-functions/refresh-token/index.ts` — refresh GHL OAuth token when near expiry (`get_token_health` + vault secrets).

```bash
supabase functions deploy refresh-token
```

Requires **`SUPABASE_URL`**, **`SUPABASE_ANON_KEY`**, and RPCs `get_token_health`, `get_vault_secrets`. **CORS:** `OPTIONS` preflight; **`GET`** or **`POST`** (no body required). Often invoked on a schedule.

### webhook (outbound GHL)

Pushes **contacts** and **tasks** to GoHighLevel when rows change in Supabase. Uses the same token/vault as `sync-ghl` (`get_token_health`, `get_vault_secrets`).

```bash
supabase db push   # creates public.webhooks + data_source on contacts/tasks
supabase functions deploy webhook
```

**Loop prevention (no infinite sync):**

| `data_source` | Meaning |
|---------------|---------|
| `app` | Created/edited in your UI → webhook **pushes** to GHL |
| `ghl` | Row from `sync-ghl` or after webhook wrote `ghl_id` → webhook **skips** |

After a successful push, the function sets `ghl_id` and `data_source = 'ghl'`. That UPDATE fires the DB webhook again, but the second run is **skipped**.

**Audit:** each run inserts two rows in `public.webhooks` (same `request_id`): `started`, then `completed` / `failed` / `skipped`.

**Supabase Database Webhook** (Dashboard → Database → Webhooks):

| Table | Events | URL |
|-------|--------|-----|
| `contacts` | Insert, Update | `https://<project>.supabase.co/functions/v1/webhook` |
| `tasks` | Insert, Update | same |

Optional header: `x-webhook-secret: <WEBHOOK_SECRET>` (set on the function).

Payload (Supabase default): `{ "type": "INSERT", "table": "tasks", "record": { ... }, "old_record": null }`.

**Users:** inbound only via `sync-ghl?sync=users`; outbound user push is logged as skipped (GHL users are not updated from Auth in v1).

When your app creates/edits tasks or contacts, set `data_source: 'app'` on the row.

**GHL task push** uses `get_token_health` (Bearer) + vault `locationId`. Maps `description` → `body`, `status_id` → `completed` (from `task_boards.is_completed`), `assigned_to` → `assignedTo` via `user_metadata.ghl_id`. Create requires `title`, `dueDate`, `completed` (default due date used if missing).

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
- `SUPABASE_DB_URL` (required for **tasks**, **task-timer**)

RPCs: `get_token_health`, `get_vault_secrets`.

---

## Other edge functions

| File | Notes |
|------|--------|
| `password-validate-send-otp.ts` | Hono; password check + OTP send/verify; CORS + `x-api-key` |
| `task-timer/index.ts` | POST/OPTIONS; append `task_sessions`, return total time (see Deploy § task-timer) |
| `refresh-token/index.ts` | GHL OAuth refresh; CORS + GET/POST/OPTIONS (see Deploy § refresh-token) |
| `webhook/index.ts` | Outbound GHL push on DB changes; audit in `public.webhooks` (see Deploy § webhook) |
| `sync-task-ghl-localy.js` | Local only, not deployed |
