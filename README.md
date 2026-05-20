# Task-Master — GHL Sync & Kanban API

Supabase Edge Functions for GoHighLevel sync and the kanban task board API. Sync checkpoints in `sync_checkpoints` use `last_cursor` to resume.

## Deploy

**sync-ghl** — source in `edge-functions/sync-ghl/`:

```
edge-functions/sync-ghl/
├── index.js                      # HTTP entry (routes ?sync=)
├── sync-constants.js
├── sync-ghl-contact-core.js
├── sync-ghl-tasks-core.js
├── sync-ghl-users-core.js        # GHL users → Supabase Auth
├── sync-ghl-tasks-list-core.js
├── task_list.js                  # TASK_LIST export (bundled with deploy)
└── sync-ghl-task-boards.js       # status map from task_boards
```

```bash
supabase functions deploy sync-ghl
```

**kanban** — source in `edge-functions/kanban.js`:

```bash
supabase functions deploy kanban
```

Requires `SUPABASE_DB_URL` on the function (direct Postgres connection).

## Recommended sync order (fresh project)

1. `?sync=contacts` — populate `contacts`
2. `?sync=users` — map GHL users to Auth (`user_metadata.ghl_id`)
3. `?sync=tasks_list` **or** `?sync=tasks` — import tasks (bundled list vs live GHL API)

## sync-ghl API

Base URL (replace `{{Supabase_ID}}` with your project ref):

```
https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl
```

| Query | Action |
|-------|--------|
| `?sync=contacts` | GHL contacts → `contacts` table |
| `?sync=tasks` | `contacts` table → GHL tasks → `tasks` table |
| `?sync=users` | GHL users → Supabase Auth (`user_metadata.ghl_id`) |
| `?sync=tasks_list` | `TASK_LIST` in `task_list.js` → `tasks` table (no GHL API) |
| `?sync=all` | Contacts, then tasks (default if `sync` omitted) |

Examples:

```
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=contacts
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=tasks
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=users
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=tasks_list
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=all
```

Supports **GET** and **POST**. Invalid `sync` returns `400` with allowed values.

### Response examples

**contacts**

```json
{
  "success": true,
  "sync": "contacts",
  "contacts": {
    "synced": 100,
    "totalSavedContacts": 1200,
    "lastCursor": "[1725807457154,\"09yw2qKSnCecMWuRjga3\"]",
    "caughtUp": false
  }
}
```

**tasks**

```json
{
  "success": true,
  "sync": "tasks",
  "tasks": {
    "synced": 42,
    "totalContactsProcessed": 500,
    "lastCursor": "uuid-of-last-contact",
    "tasksDone": false
  }
}
```

**tasks_list**

```json
{
  "success": true,
  "sync": "tasks_list",
  "tasks": {
    "success": true,
    "totalInList": 3788,
    "synced": 3500,
    "skipped": 288,
    "done": true
  }
}
```

**all**

```json
{
  "success": true,
  "sync": "all",
  "contacts": { "...": "..." },
  "tasks": { "...": "..." }
}
```

## Checkpoint keys

| `sync_checkpoints.key` | `last_cursor` stores |
|------------------------|----------------------|
| `ghl_contact_sync` | GHL `searchAfter` JSON, e.g. `[timestamp,"contactId"]` |
| `ghl_task_sync` | Last processed `contacts.id` (UUID) |

### Reset SQL

```sql
-- contacts
UPDATE sync_checkpoints
SET last_cursor = NULL, total_saved_contacts = 0, total_available_contacts = 0
WHERE key = 'ghl_contact_sync';

-- tasks
UPDATE sync_checkpoints
SET last_cursor = NULL, total_contacts_processed = 0, total_saved_tasks = 0
WHERE key = 'ghl_task_sync';
```

## Behaviour

### Contacts (`sync=contacts`)

1. POST GHL `contacts/search` with `searchAfter` pagination.
2. Upsert into `contacts` on `ghl_id`.
3. Save last contact `searchAfter` in `last_cursor`.

### Tasks (`sync=tasks`)

1. Read contacts from **Supabase** `contacts` (not GHL search).
2. Fetch tasks per `ghl_id` from GHL.
3. Upsert into `tasks` on `ghl_id`.
4. Update `contacts.total_task` with task count per contact.
5. Save last processed `contacts.id` in `last_cursor`.

**Run contact sync before task sync** on a fresh project.

### Users (`sync=users`)

1. GET GHL `/users/?locationId=…`.
2. Create or update Supabase Auth users by email; store `ghl_id` in `user_metadata`.

Run before task sync so `assigned_to` can be resolved.

### Tasks from list (`sync=tasks_list`)

1. Import `TASK_LIST` from `edge-functions/sync-ghl/task_list.js` (JavaScript module, not JSON).
2. Resolve `contactId` → `contacts.id` via `contacts.ghl_id`.
3. Upsert into `tasks` on `ghl_id` in batches of 200.

Regenerate `task_list.js` from your export when tasks change; redeploy `sync-ghl` so the bundle includes the updated list.

Example task shape:

```json
{
  "id": "EXWCtKrL6mvWOue5Uesc",
  "title": "Follow up — gauge interest in Voice AI services",
  "body": "…",
  "assignedTo": "5I9tCZVzWgTPG4AUwURz",
  "dueDate": "2026-05-19T17:00:00.000Z",
  "completed": true,
  "contactId": "HuDlvKcwaVcZzvwPm4US"
}
```

### Task status mapping

`status_id` is not hard-coded. The function loads `task_boards` (`id`, `is_completed`) and maps `completed: true` → the board with `is_completed = true`, and `completed: false` → the board with `is_completed = false`.

### All (`sync=all`)

Runs contact sync, then task sync in one request.

## Environment

Set automatically in Supabase Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

RPCs: `get_token_health`, `get_vault_secrets`.

## Scheduling

Call the function repeatedly until `caughtUp` / `tasksDone` are true. Each invocation advances checkpoints; large datasets may need many cron hits to avoid timeouts.

## kanban API

Base URL:

```
https://{{Supabase_ID}}.supabase.co/functions/v1/kanban
```

**POST** only. Returns tasks grouped by `task_boards.name`.

### Request body

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Tasks per board column |
| `order` | `"ASC"` \| `"DESC"` | `"DESC"` | Sort by `created_at` |
| `status_id` | number | — | Optional: load a single board |
| `filters` | object | — | Column filters, e.g. `{ "priority": { "value": "High" } }` |

Example:

```json
{
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "filters": {
    "priority": { "value": "Medium" }
  }
}
```

### Response shape

Top-level keys are board names; each value has `id`, `meta` (`count`, `page`, `limit`, `order`, `has_more`), and `data` (task rows with `contact`, `time_spent`, `time_spent_in_words`).

## Other edge functions

`edge-functions/` also contains `refresh-token.js`, `task-timer.js`, and local scripts (`sync-task-ghl-localy.js`). GHL sync is centralized in **`sync-ghl`**; task board reads use **`kanban`**.
