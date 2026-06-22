# Task-Master — GHL Sync & Tasks API

Supabase Edge Functions for **GoHighLevel (GHL)** sync and a **task board API**. Data is stored in Supabase (PostgreSQL + Auth); GHL is the CRM source for inbound sync, with outbound push via database webhooks.

Sync checkpoints in `sync_checkpoints` use `last_cursor` to resume long-running imports.

---

## Project structure

```
Task-Master/
├── edge-functions/
│   ├── sync-ghl/          # Inbound: GHL → Supabase (contacts, tasks, users)
│   ├── sync-from-ghl/     # GHL webhooks → Supabase (real-time sync)
│   ├── tasks/             # Task board API (read + user CRUD + comments + mentions)
│   ├── task-timer/        # Append time sessions; return total time_spent
│   ├── notification/      # Notification feed (mentions, task changes, comments)
│   ├── notification-view/ # Mark task_change_logs viewed (first open from email)
│   ├── webhook/           # Outbound GHL sync + task email notifications
│   ├── refresh-token/     # GHL OAuth token refresh
│   └── password-validate-send-otp.ts
├── supabase/migrations/   # 15 migrations: tags, comments, change logs, mentions, etc.
├── rpc-functions/         # vault, token health, task sessions, etc.
├── sample-data/           # Seed SQL for tags, assignments, country codes
└── docs/
    ├── TASKS_API.md       # Full tasks edge function reference
    └── WEBHOOK_API.md     # Outbound webhook reference
```

---

## Architecture

| Direction | Contacts | Tasks | Users |
|-----------|----------|-------|-------|
| **GHL → Supabase** | `sync-ghl?sync=contacts` | `sync-ghl?sync=tasks` | `sync-ghl?sync=users` |
| **Supabase → GHL** | DB webhook → `webhook` | DB webhook → `webhook` | `user_create` / `user_update` / `user_delete` on **tasks** |
| **App UI** | `tasks` action `contacts` | `tasks` actions `kanban`, `list`, `task_detail`; **update** via PostgREST `PATCH /rest/v1/tasks` | `tasks` actions `users`, `user_*` |

**Recommended sync order (fresh project):**

1. `?sync=contacts`
2. `?sync=users`
3. `?sync=tasks_list` or `?sync=tasks`
4. `SELECT * FROM public.sync_tags_from_tasks();` (optional)
5. Use **`tasks`** edge function for the UI

---

## REST API vs Edge Functions

Supabase exposes **two different URLs**. Do not mix them up.

| | PostgREST (database) | Edge function |
|---|---------------------|---------------|
| **URL** | `https://<project>.supabase.co/rest/v1/tasks` | `https://<project>.supabase.co/functions/v1/tasks` |
| **Purpose** | Direct read/write on the `tasks` **table** | Custom logic via `action` in JSON body |
| **Update tasks** | **`PATCH /rest/v1/tasks`** with table columns | Read/actions only via edge function `POST` |
| **`action` field** | ❌ Not a column — causes `PGRST204` on REST | ✅ Routes read handlers on `/functions/v1/tasks` |

**Do not** send `{ "action": "...", ... }` to `/rest/v1/tasks` — `action` is not a column:

```json
{ "code": "PGRST204", "message": "Could not find the 'action' column of 'tasks' in the schema cache" }
```

**`time_spent` is not a column on `tasks`.** It is computed from `task_sessions`. Do not send `time_spent` in PostgREST PATCH. Use **`task-timer`** to record time.

---

## Database ID types

| Table / column | Type |
|----------------|------|
| `tasks.id` | integer (PK) |
| `task_boards.id` / `tasks.status_id` | integer |
| `contacts.id` / `tasks.contact_id` | UUID |
| `tags.id` / `task_tags.tag_id` | integer |
| `task_tags.task_id` | integer → `tasks.id` |
| `tasks.assigned_to` | UUID (Supabase Auth user) |
| `tasks.data_source` | `engage` (GHL) or `task_master` (app) |
| `tasks.enable_ghl_sync` | boolean — `true` pushes to GHL (default), `false` skips |
| `contacts.enable_ghl_sync` | boolean — same behavior |
| `tasks.time_start_at` | timestamptz (nullable) — returned on `kanban`; updatable via PostgREST PATCH |
| `tasks.task_order` | integer (default `0`) — display order within a kanban column; updated via `update_task_order` |
| `task_sessions.task_id` | integer → `tasks.id` |
| `task_sessions.duration_seconds` | number — summed as `time_spent` in API responses |
| `country_codes.id` | smallint (PK) — dial codes for phone UI |
| `user_profiles.user_id` | UUID → `auth.users.id` |

Apply schema:

```bash
supabase db push
# or run migrations in supabase/migrations/
```

After task import, seed tag catalog and links:

```sql
SELECT * FROM public.sync_tags_from_tasks();
```

**Sample data:** [sample-data/](sample-data/)

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

**Base URL:** `https://<project>.supabase.co/functions/v1/sync-ghl`

| Query | Action |
|-------|--------|
| `?sync=contacts` | GHL contacts → `contacts` |
| `?sync=tasks` | GHL tasks per contact → `tasks` |
| `?sync=users` | GHL users → Supabase Auth |
| `?sync=tasks_list` | `task_list.js` → `tasks` (no GHL API) |
| `?sync=all` | contacts then tasks (default) |

Supports **GET** and **POST**.

#### Checkpoint keys

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

`status_id` comes from `task_boards` (`is_completed` → completed vs open board).

---

### tasks

Source: `edge-functions/tasks/` — one function, multiple actions via `action` in the body.

```
edge-functions/tasks/
├── index.js                 # POST router (?action= or body.action)
├── kanban-action.js         # action: kanban
├── list.js                  # action: list
├── task-detail.js           # action: task_detail
├── boards-action.js         # action: boards
├── tags-action.js           # action: tags
├── contacts-action.js       # action: contacts
├── country-codes-action.js  # action: country_codes
├── users-action.js          # users lookup + user_create / user_update / user_delete
├── update-task-order-action.js  # action: update_task_order (bulk kanban reorder)
├── user-phone-utils.js
├── ghl-user-sync.js
├── lookup-utils.js
├── search-utils.js
├── query.js
├── utils.js
└── db.js
```

```bash
supabase db push
supabase functions deploy tasks
```

Requires **`SUPABASE_DB_URL`** on the function. For mention email support, also set **SMTP secrets** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_BASE_URL`).

If `country_codes` returns **"Invalid action"**, redeploy **tasks** — the live function is outdated.

Manual SQL fallback: [sample-data/03_country_codes_user_profiles.sql](sample-data/03_country_codes_user_profiles.sql)

**Base URL:** `https://<project>.supabase.co/functions/v1/tasks`

**CORS:** `Access-Control-Allow-Origin: *`. Send **`OPTIONS`** for preflight; **`POST`** for all actions.

**Headers:** `Content-Type: application/json`, `apikey`, `Authorization: Bearer <jwt-or-anon-key>`

**API reference:** [docs/TASKS_API.md](docs/TASKS_API.md)

#### Actions

| Action | Purpose |
|--------|---------|
| `kanban` | Tasks grouped by `task_boards.name`; sorted by `task_order` ASC; includes `assigned_to`, `time_spent`, `time_start_at`, `task_order`, `data_source`, `description_truncated` |
| `list` | Paginated flat list; filters: `status`, `priority`, `assign`, `contacts`, `due`, `completed`, `title` + `title_match` |
| `task_detail` | One task by integer `id`; subtasks, attachments, tags, `time_spent` |
| `boards` | `task_boards` ids for filter dropdowns |
| `tags` | Autocomplete via `search_tags()` |
| `contacts` | Contact lookup / autocomplete |
| `country_codes` | Active dial codes from `public.country_codes` |
| `users` | Assignee lookup (`auth.users` + `user_profiles`) |
| `user_create` | Create Supabase Auth user; optional GHL sync |
| `user_update` | Update Supabase Auth user; optional GHL sync |
| `user_delete` | Delete Auth user; unassigns tasks by default |
| `update_task_order` | Bulk update `tasks.task_order` for kanban drag-and-drop (no `status_id` in payload) |
| `comment_create` | Add a comment to a task |
| `comment_update` | Edit a comment by `id` |
| `comment_delete` | Delete a comment by `id` |

Default action if omitted: **`kanban`**.

#### Examples

**Kanban:**

```json
POST /functions/v1/tasks
{
  "action": "kanban",
  "page": 1,
  "limit": 100,
  "order": "ASC"
}
```

Each task in `data` includes `task_order`, `time_start_at` (nullable), `time_spent`, `time_spent_in_words`, `contact`, etc. Columns are ordered by **`task_order` ASC** (then `created_at`).

**Update task order** (kanban reorder — does not send emails or push to GHL):

```json
POST /functions/v1/tasks
{
  "action": "update_task_order",
  "tasks": [
    { "task_id": 123, "task_order": 1 },
    { "task_id": 132, "task_order": 2 }
  ]
}
```

Response:

```json
{
  "success": true,
  "action": "update_task_order",
  "updated": 2,
  "tasks": [
    { "task_id": 123, "task_order": 1 },
    { "task_id": 132, "task_order": 2 }
  ]
}
```

Unknown `task_id` values are listed in `not_found` (other rows still update). Max **500** items per request.

**List:**

```json
{ "action": "list", "page": 1, "limit": 20, "sort_by": "created_at", "order": "DESC" }
```

**Task detail:**

```json
{ "action": "task_detail", "id": 424 }
```

**Task detail response** includes `comments` array alongside `logs`, `subtasks`, `tags`, etc. Comments are nested — parent comments have a `replies[]` array, replies are flat under their parent:

```json
{
  "data": {
    "id": 424,
    "comments": [
      {
        "id": 1,
        "content": "Great progress!",
        "user_id": "bba0a253-...",
        "display_name": "Ali Abbas - AG",
        "initials": "AA-A",
        "parent_id": null,
        "created_at": "2026-06-16T12:00:00.000Z",
        "updated_at": "2026-06-16T12:00:00.000Z",
        "replies": [
          {
            "id": 2,
            "content": "Thanks!",
            "user_id": "cca0b253-...",
            "display_name": "Jane Doe",
            "initials": "JD",
            "parent_id": 1,
            "created_at": "...",
            "updated_at": "..."
          }
        ]
      }
    ]
  }
}
```

`logs` excludes entries where `field_name = 'mention'` (mentions are available via the notification feed instead).

#### Task comments

| Action | Payload | Purpose |
|--------|---------|---------|
| `comment_create` | `{ "task_id": 42, "content": "...", "user_id": "auth-uuid", "parent_id": 5 }` | Add comment to task (optional `parent_id` for replies) |
| `comment_update` | `{ "id": 1, "content": "edited text" }` | Update comment content |
| `comment_delete` | `{ "id": 1 }` | Delete comment |

**`comment_create`** — `task_id` (integer), `content` (required), `user_id` (required auth UUID). `display_name` and `initials` are auto-resolved from `auth.users`.

Optional `parent_id`: integer ID of a top-level comment to reply to. Replying to a reply is **not allowed** (no deep nesting).

**@mentions** — comment content is scanned for `[Name]` patterns. Each match is resolved against `auth.users` by `display_name` (first_name + last_name) then email local-part. Mention events are logged to `task_change_logs` with `field_name = 'mention'` and an SMTP email is sent to the mentioned user using the `mention` email template.

**Response:**

```json
{ "success": true, "action": "comment_create", "data": { "id": 1, "content": "[Ali Abbas] check this", "user_id": "bba0a253-...", "display_name": "Ali Abbas - AG", "initials": "AA-A", "parent_id": null, "created_at": "...", "updated_at": "..." } }
```

**`comment_update`** — `id` (integer comment id), `content` (required new text). Returns full updated comment.

**`comment_delete`** — `id` (integer comment id). Returns `{ "deleted": true, "id": 1 }`.

Comments do **not** trigger GHL sync. No JWT verification — `user_id` is trusted from the request body.

**Update tasks** (PostgREST — triggers GHL + email via Supabase DB Webhook on `tasks` UPDATE):

```http
PATCH /rest/v1/tasks?id=eq.424
Content-Type: application/json
Authorization: Bearer <user-jwt>
apikey: <anon-key>
```

```json
{
  "title": "Enrich Data",
  "status_id": 2,
  "assigned_to": "39ad5986-96cc-4c8c-a82b-62632bed8b83",
  "data_source": "task_master"
}
```

| Field | Notes |
|-------|-------|
| Task columns | `title`, `description`, `priority`, `status_id`, `tags`, `subtasks`, `attachments`, `due_date`, `time_start_at`, `assigned_to`, `contact_id` |
| `data_source` | Set to **`task_master`** on app edits (required for email notifications) |
| `enable_ghl_sync` | `true` (default) pushes to GHL; `false` skips |

`last_changed_by_user_id` is set automatically on PATCH when the user sends a **logged-in JWT** (`Authorization: Bearer <access_token>`). You can also set it explicitly in the PATCH body. Used for **`changed_by_name`** in emails (falls back to **Someone** if missing).

Do **not** send `time_spent` — use **`task-timer`**.

Set secrets in **Supabase Dashboard → Edge Functions → Secrets**, then deploy **`webhook`** and **`tasks`** (SMTP secrets on both). For local dev, use `.env` (see **Environment**).

**Task change log (async via Supabase Database Webhook):** when a tracked field (`title`, `description`, `priority`, `status_id`, `due_date`, `assigned_to`, `contact_id`, `tags`, `subtasks`, `attachments`) changes on a row with **`data_source: task_master`**, the **Supabase DB Webhook** on `tasks` UPDATE calls **`webhook`**, which writes to **`task_change_logs`** and sends SMTP emails when `priority`, `status_id`, `due_date`, or `assigned_to` change. `time_start_at` and `task_order` changes are **not** logged. Editor name comes from **`last_changed_by_user_id`**. Requires migrations through `20260617130000_task_change_logs_rename.sql`.

**Country codes:**

```json
{ "action": "country_codes" }
```

**Create user:**

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

#### Time tracking (`time_spent`)

| Concept | Storage | How to update |
|---------|---------|---------------|
| `time_spent` (API field) | Computed: `SUM(task_sessions.duration_seconds)` | Not a DB column |
| `task_sessions` | One or more rows per task | See below |
| `time_start_at` | Column on `tasks` | PostgREST PATCH (without `time_spent`) |

| Method | Use case |
|--------|----------|
| PostgREST `PATCH /rest/v1/tasks` | Update task columns — **no `time_spent`**; set `data_source: task_master` for app edits |
| **`task-timer`** with `duration_seconds` | Record / append time sessions |

#### Country codes & phone (`country_codes` + `user_profiles`)

Dial codes in **`public.country_codes`** (US `+1`, PK `+92`; add more via SQL). Phones in **`user_profiles`** linked to `auth.users`.

**Preferred:** `country_code_id` + `phone_local` → backend builds E.164 and syncs to GHL.

Legacy **`phone`** E.164 still works.

#### User management (`user_create` / `user_update` / `user_delete`)

Users in **Supabase Auth** with phone in **`user_profiles`**. Optional outbound GHL sync via `ghl-user-sync.js`.

**GHL sync (default on):** `"enable_ghl_sync": true` pushes to GHL. Set `"enable_ghl_sync": false` to skip. Responses include `ghl_sync`:

| `ghl_sync.status` | Meaning |
|-------------------|---------|
| `completed` | GHL create / update / delete succeeded |
| `failed` | GHL error; Supabase operation still succeeded |
| `skipped` | No GHL push |

**Create** — required: `email`, `password`. Optional: `first_name`, `last_name`, `country_code_id`, `phone_local`, `phone`, `ghl_id`, `enable_ghl_sync` (default `true` pushes to GHL).

**Update** — required: `id` (Auth UUID). Optional: `email`, `first_name`, `last_name`, `country_code_id`, `phone_local`, `phone`, `ghl_id`, `password`.

**Delete** — required: `id`. Unassigns tasks by default (`unassign_tasks: false` to block).

**List users:** `{ "action": "users", "page": 1, "limit": 20, "q": "" }`

**Inbound user sync:** `GET /functions/v1/sync-ghl?sync=users`

**Vault for GHL user create:** `locationId`, `companyId` (or resolved from GHL location API). Optional: `GHL_USER_TYPE` (default `account`), `GHL_USER_ROLE` (default `user`).

**Note:** User CRUD does **not** use Database Webhooks. Contacts and tasks do.

---

### task-timer

Source: `edge-functions/task-timer/index.ts` — **append** session time and return total `time_spent`.

```bash
supabase functions deploy task-timer
```

**URL:** `POST https://<project>.supabase.co/functions/v1/task-timer`

Requires **`SUPABASE_DB_URL`**. **CORS:** `OPTIONS` preflight, `POST` only.

**Append time:**

```json
{ "task_id": 42, "duration_seconds": 120 }
```

**Read total only** (omit `duration_seconds`):

```json
{ "task_id": 42 }
```

**Response:**

```json
{ "time_spent": 3600, "time_spent_in_words": "1 hour, 0 minutes, 0 seconds" }
```

---


### refresh-token

Source: `edge-functions/refresh-token/index.ts` — refresh GHL OAuth token when near expiry.

```bash
supabase functions deploy refresh-token
```

Requires **`SUPABASE_URL`**, **`SUPABASE_ANON_KEY`**, RPCs `get_token_health`, `get_vault_secrets`.

**CORS:** `OPTIONS` preflight; **`GET`** or **`POST`**. Often invoked on a schedule.

---

### webhook (outbound GHL + task emails)

Pushes **contacts** and **tasks** to GHL when rows change in Supabase. On **`tasks` UPDATE**, also sends **task notification emails** (same DB webhook call).

```bash
supabase db push
supabase functions deploy webhook
```

```
edge-functions/webhook/
├── index.ts           # GHL DB webhook + task email on tasks UPDATE
├── push-task.ts       # tasks → GHL
├── push-contact.ts    # contacts → GHL
├── email-notify.ts    # task_change_logs + SMTP for watched field changes
├── email-smtp.ts      # nodemailer
├── email-caller.ts    # resolve changed_by_name from last_changed_by_user_id
├── email-db.ts        # postgres for email_templates / task_change_logs
├── ghl-client.ts
├── ghl-payloads.ts
├── loop-guard.ts
└── audit.ts
```

**Supabase Database Webhook** (Dashboard → Database → Webhooks) — required for GHL sync **and** task emails:

| Table | Events | URL |
|-------|--------|-----|
| `contacts` | Insert, Update | `https://<project>.supabase.co/functions/v1/webhook` |
| `tasks` | Insert, Update | `https://<project>.supabase.co/functions/v1/webhook` |

Optional header: `x-webhook-secret: <WEBHOOK_SECRET>`

Requires **`SUPABASE_DB_URL`** and SMTP secrets on **webhook**.

**`data_source` (label only):**

| Value | Meaning |
|-------|---------|
| `engage` | Row from GHL / `sync-ghl` |
| `task_master` | Row created or edited in Task Master |

Webhook pushes inserts/updates **unless** `enable_ghl_sync` is `false` on the record (default `true`). `data_source` is not used to skip.

**Loop prevention:** after push, only `ghl_id` + `updated_at` written back; webhook skips if only those changed.

**Task emails:** only on **`tasks` UPDATE** when `data_source` is **`task_master`** and watched fields changed. Assignee changes email the **new** assignee. Editor name from **`last_changed_by_user_id`** (auto-set from JWT on PATCH).

**View Task link:** `{APP_BASE_URL}/?task={task_id}&from=kanban&notification_id={task_change_logs.id}` — requires migration `20260617130000_task_change_logs_rename.sql`. Mention emails also include `&comment_id={comment.id}` to scroll to the specific comment.

**Audit:** two rows per GHL run in `public.webhooks` (`started` → `completed` / `failed` / `skipped`).

App edits should set `data_source: 'task_master'` on the row. PATCH with a **user JWT** so `last_changed_by_user_id` is captured — that triggers the DB webhook for GHL + email.

See [docs/WEBHOOK_API.md](docs/WEBHOOK_API.md).

---

### notification

Source: `edge-functions/notification/index.js` — notification feed and batch mark-read.

```bash
supabase functions deploy notification
```

**URL:** `POST https://<project>.supabase.co/functions/v1/notification`

Requires **`SUPABASE_DB_URL`**. **CORS:** `OPTIONS` preflight, `POST` only.

**List notification feed:**

```json
{
  "action": "list",
  "user_id": "bba0a253-...",
  "page": 1,
  "limit": 20
}
```

Returns mentions, task changes on your assigned tasks, and comments on your tasks:
```json
{
  "success": true,
  "action": "list",
  "data": [
    {
      "type": "mention",
      "log_id": 123,
      "task_id": 42,
      "comment_id": 5,
      "content_preview": "Hey @ali, check this!",
      "field_name": "mention",
      "changed_by_name": "John",
      "is_viewed": false,
      "created_at": "..."
    }
  ],
  "meta": { "count": 10, "page": 1, "limit": 20, "has_more": false }
}
```

**Batch mark as read:**

```json
{
  "action": "mark_read",
  "log_ids": [12, 15, 23]
}
```

Accepts `log_ids`, `ids`, or `notification_ids`. Idempotent.

---

### notification-view

Source: `edge-functions/notification-view/index.ts` — record first view when the user opens a task from an email link.

```bash
supabase db push
supabase functions deploy notification-view
```

**URL:** `POST https://<project>.supabase.co/functions/v1/notification-view`

Requires **`SUPABASE_DB_URL`**. **CORS:** `OPTIONS` preflight, `POST` only.

**Mark viewed (idempotent — only first view updates `viewed_at`):**

```json
{ "log_id": 42 }
```

Also accepts `notification_id` (same id) for backward-compatible email links.

**Response (first view):**

```json
{
  "success": true,
  "first_view": true,
  "log_id": 42,
  "notification_id": 42,
  "task_id": 769,
  "is_viewed": true,
  "viewed_at": "2026-06-16T12:00:00.000Z"
}
```

**Response (already viewed):** same shape with `"first_view": false` and the original `viewed_at`.

---

## Environment

**Local development:** copy `.env.example` → `.env` (gitignored), fill in values, then:

```bash
supabase functions serve webhook --env-file .env
supabase functions serve tasks --env-file .env
```

**Production:** set secrets in **Supabase Dashboard → Edge Functions → Secrets** and deploy each function.

On Edge Functions:

| Variable | Required by |
|----------|-------------|
| `SUPABASE_URL` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | **webhook**, **tasks** (user GHL sync) |
| `SUPABASE_DB_URL` | **tasks**, **task-timer**, **notification**, **notification-view**, **webhook** (email SQL) |
| `SMTP_HOST` | **webhook**, **tasks** (mention emails) — e.g. `smtp.gmail.com` |
| `SMTP_PORT` | **webhook**, **tasks** — e.g. `465` |
| `SMTP_USER` | **webhook**, **tasks** — SMTP login email |
| `SMTP_PASS` | **webhook**, **tasks** — Gmail App Password (required) |
| `MAIL_FROM` | **webhook**, **tasks** — sender email, e.g. `ali@yourdomain.com` |
| `MAIL_FROM_NAME` | Optional — inbox sender name; defaults to **`Task Master`** |
| `APP_BASE_URL` | **webhook**, **tasks** — app URL for email links |
| `SMTP_SECURE` | Optional — `true` / `false`; auto `true` when port is `465` |
| `GHL_USER_TYPE` | Optional — GHL user create (default `account`) |
| `GHL_USER_ROLE` | Optional — GHL user create (default `user`) |
| `WEBHOOK_SECRET` | Optional — **webhook** (GHL DB webhook + internal email invoke) |

**Vault secrets** (via `get_vault_secrets` RPC):

| Name | Used by |
|------|---------|
| `locationId` | sync-ghl, webhook, user GHL sync |
| `companyId` | user GHL create/update |
| `clientId`, `clientSecret` | refresh-token |

**RPCs** (in `rpc-functions/`): `get_token_health`, `get_vault_secrets`, `get_task_total`, `save_task_session`, etc.

---

## Other edge functions

| File | Notes |
|------|--------|
| `password-validate-send-otp.ts` | Hono; password check + OTP; CORS + `x-api-key` |
| `task-timer/index.ts` | Append `task_sessions`; return total time |
| `sync-from-ghl/index.js` | GHL webhook receiver — TaskCreate/Complete/Delete, Contact CRUD, User CRUD |
| `notification/index.js` | Notification feed (mentions, task changes, comments) + batch mark-read |
| `notification-view/index.ts` | Mark `task_change_logs` viewed on first email link open |
| `refresh-token/index.ts` | GHL OAuth refresh |
| `webhook/index.ts` | GHL push + task emails on `tasks` UPDATE (Supabase DB Webhook) |
| `sync-task-ghl-localy.js` | Local only, not deployed |

---

## Frontend integration checklist

1. **Read tasks** → `POST /functions/v1/tasks` with `kanban`, `list`, or `task_detail`
2. **Update tasks** → `PATCH /rest/v1/tasks?id=eq.{id}` with task columns + `data_source: task_master` (use **user JWT**, not anon key only). Set `enable_ghl_sync: false` to skip GHL push.
3. **Timer tick** → `POST /functions/v1/task-timer` to append seconds
4. **Reorder kanban** → `POST /functions/v1/tasks` with `action: update_task_order` and `tasks: [{ task_id, task_order }, ...]`
5. **Do not PATCH** `time_spent`, `action`, `contact`, `time_spent_in_words`, or `description_truncated` to PostgREST
6. **Users** → `user_create` / `user_update` / `user_delete` on the **tasks** function
7. **Email link open** → on `/?task={id}&from=kanban&notification_id={id}`, `POST /functions/v1/notification-view` with `{ "log_id": <id> }` or `{ "notification_id": <id> }` (fire-and-forget)
8. **Comments** → `comment_create` / `comment_update` / `comment_delete` on the **tasks** function. Use `parent_id` for replies (top-level comments only). Use `[Name]` syntax for @mentions.
9. **Notification feed** → `POST /functions/v1/notification` with `{ "action": "list", "user_id": "<uuid>" }`
10. **Mark notifications read** → `POST /functions/v1/notification` with `{ "action": "mark_read", "log_ids": [...] }`
11. **Email link open** — mention email URLs include `&comment_id={id}`; parse and scroll to that comment on the task detail page.

**Supabase JS (update task):**

```javascript
const { data, error } = const { data: { session } } = await supabase.auth.getSession();

await supabase
  .from('tasks')
  .update({
    title: '...',
    status_id: 1,
    data_source: 'task_master',
    // last_changed_by_user_id set automatically by DB trigger when session JWT is used
  })
  .eq('id', 424)
  .select()
  .single();
```
