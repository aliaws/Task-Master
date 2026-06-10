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
| `tasks.data_source` | `engage` (GHL) or `task_master` (app); returned on `list` and `kanban` |
| `country_codes.id` | smallint (PK) — dial codes for phone UI |
| `user_profiles.user_id` | UUID → `auth.users.id` — phone + country code FK |

Apply tags schema once:

```bash
supabase db push
# or run supabase/migrations/20260520120000_tags.sql
# and supabase/migrations/20260610120000_country_codes_user_profiles.sql
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
├── country-codes-action.js  # action: country_codes — dial code list from DB
├── users-action.js       # users lookup + create / update / delete
├── user-phone-utils.js   # phone E.164 + user_profiles helpers
├── ghl-user-sync.js      # outbound GHL user sync (create / update / delete)
├── lookup-utils.js
├── search-utils.js       # shared ILIKE / search operators
├── query.js              # list filters + SQL
├── utils.js
└── db.js
```

```bash
supabase db push
supabase functions deploy tasks
```

Requires **`SUPABASE_DB_URL`** on the function (country codes, user profiles, user delete unassign).

If `country_codes` returns "Invalid action", redeploy **tasks** — the live function is outdated.

Manual SQL fallback: [sample-data/03_country_codes_user_profiles.sql](sample-data/03_country_codes_user_profiles.sql)

**CORS:** Responses include `Access-Control-Allow-Origin: *` and allowed headers (`authorization`, `x-client-info`, `apikey`, `content-type`, `x-api-key`). Send **`OPTIONS`** for preflight; **`POST`** for all actions (same pattern as `password-validate-send-otp`).

**API reference:** [docs/TASKS_API.md](docs/TASKS_API.md)

| Action | Purpose |
|--------|---------|
| `kanban` | Tasks grouped by `task_boards.name` (default); `assigned_to`, `time_spent`, `data_source`, `description_truncated` (HTML stripped; optional `description_truncate_length`, default **20**) |
| `list` | Paginated list; filters: `status`, `priority`, `assign`, `contacts`, `due`, `completed`, `title` + `title_match`; `description_truncated` (HTML stripped; optional `description_truncate_length`, default **20**) |
| `task_detail` | One task by integer `id`; subtasks, attachments, tags, `time_spent` (same as kanban) |
| `boards` | Integer `task_boards.id` for filter dropdowns |
| `tags` | Autocomplete via `search_tags()` |
| `contacts` | Contact lookup: autocomplete or `search_column` + `search_operator` |
| `country_codes` | Active dial codes from `public.country_codes` (for phone UI dropdown) |
| `users` | Assignee lookup (`auth.users` + `user_profiles`): same filter modes as `contacts` |
| `user_create` | Create Supabase Auth user; optional outbound sync to GHL (see **User management**) |
| `user_update` | Update Supabase Auth user; optional outbound sync to GHL |
| `user_delete` | Delete Supabase Auth user; unassigns tasks by default; optional GHL delete |

Example (list):

```
POST https://{{Supabase_ID}}.supabase.co/functions/v1/tasks
{ "action": "list", "page": 1, "limit": 20, "sort_by": "created_at", "order": "DESC" }
```

Example (create user with country code):

```
POST https://{{Supabase_ID}}.supabase.co/functions/v1/tasks
{
  "action": "user_create",
  "email": "ali@example.com",
  "password": "SecurePassword123!",
  "first_name": "Ali",
  "last_name": "Khan",
  "country_code_id": 2,
  "phone_local": "3034683389"
}
```

Example (list country codes for phone component):

```
POST https://{{Supabase_ID}}.supabase.co/functions/v1/tasks
{ "action": "country_codes" }
```

**Sample data** (tags, assignees, optional contacts): [sample-data/](sample-data/)

#### Country codes & phone (`country_codes` + `user_profiles`)

Dial codes live in **`public.country_codes`** (seeded with US `+1` and PK `+92`; add more via SQL). User phones live in **`public.user_profiles`** linked to `auth.users`.

**List country codes** (for frontend phone dropdown):

```json
{ "action": "country_codes" }
```

**Create / update phone (preferred):** send `country_code_id` + `phone_local`. Backend builds E.164 `phone` (e.g. `+923034683389`) and syncs that to GHL.

Legacy **`phone`** E.164 string still works; backend parses it into `country_code_id` + `phone_local` when possible.

#### User management (`user_create` / `user_update` / `user_delete`)

Users live in **Supabase Auth** (`auth.users`) with phone details in **`user_profiles`**. These actions use the Auth Admin API and optionally push to GHL via `ghl-user-sync.js`.

**GHL sync (default on):** set `"sync_ghl": false` to skip GHL. Responses include `ghl_sync`:

| `ghl_sync.status` | Meaning |
|-------------------|---------|
| `completed` | GHL create / update / delete succeeded |
| `failed` | GHL error; Supabase operation still succeeded |
| `skipped` | No GHL push (disabled, no `ghl_id`, etc.) |

**Create** — required: `email`, `password`. Optional: `first_name`, `last_name`, `country_code_id`, `phone_local`, `phone` (legacy E.164), `ghl_id`, `sync_ghl`.

```json
{
  "action": "user_create",
  "email": "ali@example.com",
  "password": "SecurePassword123!",
  "first_name": "Ali",
  "last_name": "Khan",
  "country_code_id": 2,
  "phone_local": "3034683389"
}
```

On success, `ghl_id` from GHL is saved to `user_metadata.ghl_id`. Response includes `phone`, `phone_local`, and nested `country_code`.

**Update** — required: `id` (Supabase Auth UUID). Send only fields to change: `email`, `first_name`, `last_name`, `country_code_id`, `phone_local`, `phone`, `ghl_id`, `password` (GHL password only unless you extend Auth update).

```json
{
  "action": "user_update",
  "id": "SUPABASE_AUTH_UUID",
  "country_code_id": 2,
  "phone_local": "3034683389"
}
```

`phone` (E.164) is stored in `user_profiles.phone` and mirrored in `user_metadata.phone`; synced to GHL on create/update when `sync_ghl` is enabled.

**Delete** — required: `id`. By default unassigns all tasks (`assigned_to = NULL`), then deletes from GHL (if `ghl_id` exists), then deletes from Supabase Auth.

```json
{
  "action": "user_delete",
  "id": "SUPABASE_AUTH_UUID"
}
```

Block delete when tasks are assigned: `"unassign_tasks": false`.

**List users** (get `id` for update/delete):

```json
{ "action": "users", "page": 1, "limit": 20, "q": "" }
```

**Inbound user sync from GHL** (pull, not webhook): `GET /functions/v1/sync-ghl?sync=users` — parses GHL `phone` into `country_code_id` + `phone_local` in `user_profiles`.

**Vault for GHL user create:** `locationId` (required), `companyId` (required — or resolved from GHL location API). Optional env: `GHL_USER_TYPE` (default `account`), `GHL_USER_ROLE` (default `user`).

**Note:** User add/edit/delete does **not** use Supabase Database Webhooks (Auth is not a `public` table). Contacts and tasks use webhooks; users sync via these `tasks` actions or `sync-ghl?sync=users`.

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

**`data_source` (label only):**

| Value | Meaning |
|-------|---------|
| `engage` | Row came from Engage/GHL (`sync-ghl`) |
| `task_master` | Row created in Task Master |

Webhook **always pushes** inserts/updates to GHL. `data_source` is not used to skip.

**Loop prevention:** after a successful push, only `ghl_id` + `updated_at` are written back; if the webhook fires again with only those fields changed, that run is skipped.

**Audit:** each run inserts two rows in `public.webhooks` (same `request_id`): `started`, then `completed` / `failed` / `skipped`.

**Supabase Database Webhook** (Dashboard → Database → Webhooks):

| Table | Events | URL |
|-------|--------|-----|
| `contacts` | Insert, Update | `https://<project>.supabase.co/functions/v1/webhook` |
| `tasks` | Insert, Update | `https://<project>.supabase.co/functions/v1/webhook` |

**Users are not configured here** — Auth users sync outbound via `user_create` / `user_update` / `user_delete` on the **tasks** function, or inbound via `sync-ghl?sync=users`.

Optional header: `x-webhook-secret: <WEBHOOK_SECRET>` (set on the function).

Set `data_source: 'task_master'` when your app creates a row; `sync-ghl` sets `engage` on import.

**GHL payloads** are built in `edge-functions/webhook/ghl-payloads.ts` (not full DB rows). Webhook body only needs `record.id`; the function loads the row and sends GHL fields only. See [docs/WEBHOOK_API.md](docs/WEBHOOK_API.md).

---

## Recommended sync order (fresh project)

1. `?sync=contacts`
2. `?sync=users`
3. `?sync=tasks_list` or `?sync=tasks`
4. `SELECT * FROM public.sync_tags_from_tasks();` (optional)
5. Use `tasks` API for UI

### Sync direction summary

| Entity | GHL → Supabase (inbound) | Supabase → GHL (outbound) |
|--------|--------------------------|---------------------------|
| Contacts | `sync-ghl?sync=contacts` | Database Webhook → `webhook` |
| Tasks | `sync-ghl?sync=tasks` | Database Webhook → `webhook` |
| Users | `sync-ghl?sync=users` | `user_create` / `user_update` / `user_delete` on **tasks** |

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
- `SUPABASE_DB_URL` (required for **tasks**, **task-timer** — user delete unassign uses SQL)
- `GHL_USER_TYPE` (optional, default `account` — GHL user create/update)
- `GHL_USER_ROLE` (optional, default `user` — GHL user create/update)
- `WEBHOOK_SECRET` (optional, **webhook** function)

**Vault secrets** (via `get_vault_secrets` RPC):

| Name | Used by |
|------|---------|
| `locationId` | sync-ghl, webhook, user GHL sync |
| `companyId` | user GHL create/update (fallback: fetched from GHL location API) |
| `clientId`, `clientSecret` | refresh-token |

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
