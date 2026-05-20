# Task-Master — GHL Sync

One Supabase Edge Function **`sync-ghl`** syncs GoHighLevel contacts and tasks. Checkpoints in `sync_checkpoints` use `last_cursor` to resume.

## Deploy

Source lives in `edge-functions/sync-ghl/`:

```
edge-functions/sync-ghl/
├── index.js                 # HTTP entry (routes ?sync=)
├── sync-constants.js
├── sync-ghl-contact-core.js
└── sync-ghl-tasks-core.js
```

```bash
supabase functions deploy sync-ghl
```

## API

Base URL (replace `{{Supabase_ID}}` with your project ref):

```
https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl
```

| Query | Action |
|-------|--------|
| `?sync=contacts` | GHL contacts → `contacts` table |
| `?sync=tasks` | `contacts` table → GHL tasks → `tasks` table |
| `?sync=all` | Contacts, then tasks (default if `sync` omitted) |

Examples:

```
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=contacts
GET https://{{Supabase_ID}}.supabase.co/functions/v1/sync-ghl?sync=tasks
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
SET last_cursor = NULL, total_contacts_processed = 0, total_tasks = 0
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

### All (`sync=all`)

Runs contact sync, then task sync in one request.

## Environment

Set automatically in Supabase Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

RPCs: `get_token_health`, `get_vault_secrets`.

## Scheduling

Call the function repeatedly until `caughtUp` / `tasksDone` are true. Each invocation advances checkpoints; large datasets may need many cron hits to avoid timeouts.

## Other edge functions

`edge-functions/` also contains unrelated functions (`kanban.js`, `refresh-token.js`, etc.). Only `sync-ghl/` is the unified GHL sync entrypoint.
