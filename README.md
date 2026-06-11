# Task-Master — GHL Sync & Tasks API

Supabase Edge Functions for **GoHighLevel (GHL)** sync and a **task board API**. Data is stored in Supabase (PostgreSQL + Auth); GHL is the CRM source for inbound sync, with outbound push via database webhooks.

Sync checkpoints in `sync_checkpoints` use `last_cursor` to resume long-running imports.

---

## Project structure

```
Task-Master/
├── edge-functions/
│   ├── sync-ghl/          # Inbound: GHL → Supabase (contacts, tasks, users)
│   ├── tasks/             # Task board API (read + user CRUD)
│   ├── task-timer/        # Append time sessions; return total time_spent
│   ├── webhook/           # Outbound GHL sync + task email notifications
│   ├── refresh-token/     # GHL OAuth token refresh
│   └── password-validate-send-otp.ts
├── supabase/migrations/   # tags, webhooks, country_codes, user_profiles
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
| `tasks.time_start_at` | timestamptz (nullable) — returned on `kanban`; updatable via PostgREST PATCH |
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

Requires **`SUPABASE_DB_URL`** on the function.

If `country_codes` returns **"Invalid action"**, redeploy **tasks** — the live function is outdated.

Manual SQL fallback: [sample-data/03_country_codes_user_profiles.sql](sample-data/03_country_codes_user_profiles.sql)

**Base URL:** `https://<project>.supabase.co/functions/v1/tasks`

**CORS:** `Access-Control-Allow-Origin: *`. Send **`OPTIONS`** for preflight; **`POST`** for all actions.

**Headers:** `Content-Type: application/json`, `apikey`, `Authorization: Bearer <jwt-or-anon-key>`

**API reference:** [docs/TASKS_API.md](docs/TASKS_API.md)

#### Actions

| Action | Purpose |
|--------|---------|
| `kanban` | Tasks grouped by `task_boards.name`; includes `assigned_to`, `time_spent`, `time_start_at`, `data_source`, `description_truncated` |
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

Each task in `data` includes `time_start_at` (nullable), `time_spent`, `time_spent_in_words`, `contact`, etc.

**List:**

```json
{ "action": "list", "page": 1, "limit": 20, "sort_by": "created_at", "order": "DESC" }
```

**Task detail:**

```json
{ "action": "task_detail", "id": 424 }
```

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

Do **not** send `time_spent` — use **`task-timer`**.

Set secrets in **Supabase Dashboard → Edge Functions → Secrets**, then deploy **`webhook`** (SMTP secrets on **webhook**). For local dev, use `.env` (see **Environment**).

**Email notifications (async via Supabase Database Webhook):** when `priority`, `status_id`, `due_date`, or `assigned_to` change on a row with **`data_source: task_master`**, the **Supabase DB Webhook** on `tasks` UPDATE calls **`webhook`**, which sends SMTP emails and logs to `email_notifications`. Emails show **Someone** as the editor for now. Requires migrations through `20260613120000_email_templates_task_master_branding.sql`.

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

**GHL sync (default on):** `"sync_ghl": false` to skip. Responses include `ghl_sync`:

| `ghl_sync.status` | Meaning |
|-------------------|---------|
| `completed` | GHL create / update / delete succeeded |
| `failed` | GHL error; Supabase operation still succeeded |
| `skipped` | No GHL push |

**Create** — required: `email`, `password`. Optional: `first_name`, `last_name`, `country_code_id`, `phone_local`, `phone`, `ghl_id`, `sync_ghl`.

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
├── email-notify.ts    # compare old_record/record, email_notifications, SMTP
├── email-smtp.ts      # nodemailer
├── email-db.ts        # postgres for email_templates / email_notifications
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

Webhook **always pushes** inserts/updates. `data_source` is not used to skip.

**Loop prevention:** after push, only `ghl_id` + `updated_at` written back; webhook skips if only those changed.

**Task emails:** only on **`tasks` UPDATE** when `data_source` is **`task_master`** and watched fields changed. Assignee changes email the **new** assignee. Editor name in email is **Someone** for now.

**Audit:** two rows per GHL run in `public.webhooks` (`started` → `completed` / `failed` / `skipped`).

App edits should set `data_source: 'task_master'` on the row — that triggers the DB webhook for GHL + email.

See [docs/WEBHOOK_API.md](docs/WEBHOOK_API.md).

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
| `SUPABASE_DB_URL` | **tasks**, **task-timer**, **webhook** (email SQL) |
| `SMTP_HOST` | **webhook** — e.g. `smtp.gmail.com` |
| `SMTP_PORT` | **webhook** — e.g. `465` |
| `SMTP_USER` | **webhook** — SMTP login email |
| `SMTP_PASS` | **webhook** — Gmail App Password (required) |
| `MAIL_FROM` | **webhook** — sender email, e.g. `ali@yourdomain.com` |
| `MAIL_FROM_NAME` | Optional — inbox sender name; defaults to **`Task Master`** |
| `APP_BASE_URL` | **webhook** — app URL for email links |
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
| `refresh-token/index.ts` | GHL OAuth refresh |
| `webhook/index.ts` | GHL push + task emails on `tasks` UPDATE (Supabase DB Webhook) |
| `sync-task-ghl-localy.js` | Local only, not deployed |

---

## Frontend integration checklist

1. **Read tasks** → `POST /functions/v1/tasks` with `kanban`, `list`, or `task_detail`
2. **Update tasks** → `PATCH /rest/v1/tasks?id=eq.{id}` with task columns + `data_source: task_master`
3. **Timer tick** → `POST /functions/v1/task-timer` to append seconds
4. **Do not PATCH** `time_spent`, `action`, `contact`, `time_spent_in_words`, or `description_truncated` to PostgREST
5. **Users** → `user_create` / `user_update` / `user_delete` on the **tasks** function

**Supabase JS (update task):**

```javascript
const { data, error } = await supabase
  .from('tasks')
  .update({
    title: '...',
    status_id: 1,
    data_source: 'task_master',
  })
  .eq('id', 424)
  .select()
  .single();
```
