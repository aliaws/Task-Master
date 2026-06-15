# Tasks API

Single edge function **`tasks`** exposes board, list, detail, lookup (contacts, users, tags), and boards actions via **POST**. Use **`action`** in the JSON body or query string (`?action=list`). Default action is **`kanban`**.

**Base URL**

```
https://{{Supabase_ID}}.supabase.co/functions/v1/tasks
```

### ID types in this API

| Table / field | Type |
|---------------|------|
| `tasks.id` | **integer** (primary key) |
| `task_boards.id` / `tasks.status_id` | **integer** |
| `contacts.id` / `tasks.contact_id` | **UUID** |
| `tags.id` / `task_tags.tag_id` | **integer** |
| `task_tags.task_id` | **integer** → `tasks.id` |
| `tasks.assigned_to` | Usually **UUID** (Supabase Auth user id from sync) |

### What is `filters.status`?

Each value is an **integer** `task_boards.id` (kanban column), e.g. `1`, `4` — **not** the string `"uuid"` from docs.

Get board ids: `{ "action": "boards" }` or `SELECT id, name FROM public.task_boards;`

Requires **`SUPABASE_DB_URL`** on the function.

---

## Deploy

```bash
supabase functions deploy tasks
```

Apply tags schema:

```bash
supabase db push
# or run supabase/migrations/20260520120000_tags.sql in the SQL editor
```

---

## Shared request fields

| Field | Type | Default | Applies to |
|-------|------|---------|------------|
| `action` | string | `kanban` | all |
| `page` | number | `1` | `kanban`, `list` |
| `limit` | number | `20` | `kanban`, `list` (max 100 on `list`) |
| `order` | `"ASC"` \| `"DESC"` | `"DESC"` | all (latest first) |
| `sort_by` | string | `created_at` | `list` only |

**`sort_by` values:** `created_at`, `updated_at`, `due_date`, `priority`, `title`

---

## 1. `kanban`

Board columns keyed by `task_boards.name`. Tasks within each column are ordered by **`task_order` ASC** (then `created_at`). Each task row includes `task_order`.

### Body

```json
{
  "action": "kanban",
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "description_truncate_length": 20,
  "status_id": null,
  "filters": {
    "priority": { "value": "High" }
  }
}
```

| Field | Description |
|-------|-------------|
| `status_id` | Optional single board id (number, legacy) |
| `description_truncate_length` | Optional; HTML stripped before truncate (alias: `truncated_length`). Default **20**, min 20, max 500 |
| `filters` | Column → `{ "value": "..." }` (legacy kanban filters) |

### Response

Object keyed by board name; each column has `id`, `is_completed`, `sort_order`, `meta`, `data` (full task rows with `contact`, `time_spent`, etc.).

```json
"To Do": {
  "id": 1,
  "is_completed": false,
  "sort_order": 1,
  "meta": {
    "count": 12,
    "page": 1,
    "limit": 20,
    "order": "DESC",
    "has_more": false,
    "description_truncate_length": 20
  },
  "data": [
    {
      "description": "<p>They just need help with \"Portfolio\" page, uploading images…</p>",
      "description_truncated": "They just need help with \"Portfolio\" page.."
    }
  ]
}
```

---

## 2. `list`

Flat paginated task list for tables / mobile list views.

### Body

```json
{
  "action": "list",
  "page": 1,
  "limit": 20,
  "sort_by": "created_at",
  "order": "DESC",
  "description_truncate_length": 20,
  "filters": {
    "status": [1, 2],
    "priority": "High",
    "title": "Call",
    "title_match": "contains",
    "assign": ["auth-user-uuid-if-used"],
    "contacts": ["550e8400-e29b-41d4-a716-446655440000"],
    "due": "overdue",
    "completed": false
  }
}
```

### Filters (`filters` object)

| Key | Type | Description |
|-----|------|-------------|
| `status` | int or int[] | **`task_boards.id`** (integer), from `boards` or `kanban` |
| `priority` | string | Exact match on `tasks.priority` (e.g. `"High"`, `"Medium"`, `"Low"`) |
| `title` | string | Case-insensitive search on `tasks.title` (see `title_match`) |
| `title_match` | string | How `title` is matched: `starts_with` \| `contains` \| `ends_with` (default `contains`) |
| `assign` | uuid or uuid[] / int or int[] | `tasks.assigned_to` (auth UUIDs from sync, or ints if your column is int) |
| `contacts` | uuid or uuid[] | **`contacts.id` only** (UUID) |
| `due` | string | `today` \| `overdue` \| `coming` (by `due_date`) |
| `completed` | boolean | `true` = only completed board; `false` = exclude completed board |

**Title search**

- `title` — non-empty string to search for (`%` and `_` in the value are escaped)
- `title_match` — optional; defaults to `contains`
  - `starts_with` — title begins with the string
  - `contains` — title includes the string anywhere
  - `ends_with` — title ends with the string
- Matching uses `ILIKE` (case-insensitive)

**Due filters**

- `today` — due date is today (UTC)
- `overdue` — `due_date < now`, excluding completed board
- `coming` — `due_date > now`

### Task detail response includes `logs` and `comments`

The `task_detail` response includes a `logs` array (task change history) and a `comments` array (user comments), in addition to all task fields.

```json
{
  "success": true,
  "action": "task_detail",
  "data": {
    "id": 42,
    "...": "...",
    "logs": [
      {
        "id": 105,
        "field_name": "priority",
        "old_display_value": "High",
        "new_display_value": "Low",
        "changed_by_name": "Ali",
        "is_viewed": true,
        "viewed_at": "2026-06-15T12:00:00.000Z",
        "created_at": "2026-06-15T11:30:00.000Z"
      }
    ],
    "comments": [
      {
        "id": 1,
        "content": "Great progress!",
        "user_id": "bba0a253-...",
        "display_name": "Ali Abbas - AG",
        "initials": "AA-A",
        "created_at": "2026-06-16T12:00:00.000Z",
        "updated_at": "2026-06-16T12:00:00.000Z"
      }
    ]
  }
}
```

---

## 9. Task Comments

Add, edit, and delete comments on tasks via the `tasks` edge function.

| Action | Purpose |
|--------|---------|
| `comment_create` | Add a comment to a task |
| `comment_update` | Edit a comment by `id` |
| `comment_delete` | Delete a comment by `id` |

### `comment_create`

```json
{
  "action": "comment_create",
  "task_id": 42,
  "content": "Great work on this task!",
  "user_id": "bba0a253-8eab-43ed-afdf-c9014ca319f2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | integer | yes | `tasks.id` |
| `content` | string | yes | Comment text |
| `user_id` | string | yes | Auth user UUID — `display_name` and `initials` auto-resolved from `auth.users` |

**Response:**

```json
{
  "success": true,
  "action": "comment_create",
  "data": {
    "id": 1,
    "content": "Great work on this task!",
    "user_id": "bba0a253-8eab-43ed-afdf-c9014ca319f2",
    "display_name": "Ali Abbas - AG",
    "initials": "AA-A",
    "created_at": "2026-06-16T12:00:00.000Z",
    "updated_at": "2026-06-16T12:00:00.000Z"
  }
}
```

### `comment_update`

```json
{
  "action": "comment_update",
  "id": 1,
  "content": "Updated comment text"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | yes | `task_comments.id` |
| `content` | string | yes | New comment text |

**Response:** full updated comment object.

### `comment_delete`

```json
{
  "action": "comment_delete",
  "id": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | yes | `task_comments.id` to delete |

**Response:**

```json
{
  "success": true,
  "action": "comment_delete",
  "deleted": true,
  "id": 1
}
```

Comments do **not** trigger GHL sync or email notifications.

---

### Response row shape

```json
{
  "success": true,
  "action": "list",
  "data": [
    {
      "id": 42,
      "title": "Call Dana",
      "priority": "Medium",
      "status": { "id": 2, "name": "In Progress" },
      "description": "They just need help with \"Portfolio\" page, uploading images…",
      "description_truncated": "They just need help with \"Portfolio\" page..",
      "contact": { "id": "550e8400-...", "name": "Jane Doe", "email": "j@example.com" },
      "assigned_to": {
        "id": "auth-user-uuid",
        "display_name": "John Smith",
        "initials": "JS"
      },
      "due_date": "2026-05-19T17:00:00.000Z",
      "ghl_id": "EXWCtKrL6mvWOue5Uesc",
      "data_source": "engage",
      "time_spent": 3600,
      "time_spent_in_words": "1 hour, 0 minutes, 0 seconds",
      "created_at": "2026-05-01T12:00:00.000Z",
      "updated_at": "2026-05-02T12:00:00.000Z"
    }
  ],
  "meta": {
    "count": 120,
    "page": 1,
    "limit": 20,
    "total_pages": 6,
    "has_more": true,
    "sort_by": "created_at",
    "order": "DESC"
  }
}
```

**Initials rule:** two-word display name → both initials (`John Doe` → `JS`); one word → first letter (`Madonna` → `M`).

**`description_truncated`:** Short preview on `list` and `kanban` only. HTML tags are stripped first. Uses the first clause before a comma when present, otherwise trims at a word boundary, with `..` when shortened. Full text remains in `description`.

**`description_truncate_length`:** Optional on `list` and `kanban` request body (alias: `truncated_length`). Default **20**, min 20, max 500. Echoed in `meta.description_truncate_length` (kanban: per-column `meta`).

---

## 3. `task_detail`

Single task with subtasks, attachments, tags, change logs, and comments.

### Body

```json
{
  "action": "task_detail",
  "id": 42
}
```

`task_id` is accepted as an alias for `id`.

### Response

Same fields as list (including `time_spent` and `time_spent_in_words` from `task_sessions`), plus:

```json
{
  "time_spent": 3600,
  "time_spent_in_words": "1 hour, 0 minutes, 0 seconds",
  "subtasks": [],
  "attachments": [],
  "tags": ["voice-ai", "follow-up"]
}
```

`time_spent` is total `duration_seconds` summed from `public.task_sessions` (same as kanban).

Response also includes `task_order` (integer).

---

## 4. `update_task_order`

Bulk update `tasks.task_order` for kanban drag-and-drop. Does **not** require `status_id`. Does not trigger task notification emails or GHL push (webhook skips when only `task_order` / `updated_at` change).

### Body

```json
{
  "action": "update_task_order",
  "tasks": [
    { "task_id": 123, "task_order": 0 },
    { "task_id": 132, "task_order": 1 }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `tasks` | array | Required, 1–500 items |
| `tasks[].task_id` | integer | `tasks.id` (alias: `id`) |
| `tasks[].task_order` | integer | Non-negative; lower = higher in column |

### Response

```json
{
  "success": true,
  "action": "update_task_order",
  "updated": 2,
  "tasks": [
    { "task_id": 123, "task_order": 0 },
    { "task_id": 132, "task_order": 1 }
  ]
}
```

If any `task_id` does not exist, it appears in `not_found`; other rows still update.

Kanban reads use `ORDER BY task_order ASC` within each column.

---

## 5. `boards`

List kanban columns with ids for building `filters.status`.

### Body

```json
{ "action": "boards" }
```

### Response

```json
{
  "success": true,
  "action": "boards",
  "data": [
    { "id": 1, "name": "To Do", "is_completed": false, "sort_order": 1 },
    { "id": 4, "name": "Completed", "is_completed": true, "sort_order": 4 }
  ]
}
```

---

## 6. `tags` (autocomplete)

Search the `tags` catalog (see migration SQL).

### Body

```json
{
  "action": "tags",
  "q": "vo",
  "limit": 20
}
```

Empty `q` returns up to `limit` tags alphabetically.

### Response

```json
{
  "success": true,
  "action": "tags",
  "data": [{ "id": 4, "name": "voice-ai" }],
  "meta": { "q": "vo", "limit": 20, "count": 1 }
}
```

After bulk task import, populate the catalog and `task_tags` links:

```sql
SELECT * FROM public.sync_tags_from_tasks();
-- returns tags_inserted, links_inserted
```

Dev sample tags/assign SQL: `sample-data/` in the repo root.

---

## 7. `contacts` (lookup)

Search `public.contacts` for filter dropdowns and assignee pickers. Use **`filters`** to choose mode.

### Autocomplete (prefix match on display name)

```json
{
  "action": "contacts",
  "q": "mar",
  "limit": 20,
  "filters": { "autocomplete": true }
}
```

### Column search

```json
{
  "action": "contacts",
  "page": 1,
  "q": "McCarthy",
  "limit": 20,
  "filters": {
    "search_column": "name",
    "search_operator": "contains"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (1-based) |
| `limit` | number | `20` | Page size (max 100) |
| `q` | string | `""` | Search term |

| `filters` field | Type | Description |
|-----------------|------|-------------|
| `autocomplete` | boolean | `true` → prefix search on display name (name or email) |
| `search_column` | string | `name` (default), `email`, `phone`, `first_name`, `last_name` |
| `search_operator` | string | `starts_with` \| `contains` \| `ends_with` \| `equal` (default `contains`) |

`equal` — case-insensitive exact match on `search_column` (no partial match).

Empty `q` returns up to `limit` rows sorted by display name.

### Response

```json
{
  "success": true,
  "action": "contacts",
  "data": [
    {
      "id": "a1b2c3d4-e5f6-4789-a012-345678901001",
      "display_name": "Maria Lopez",
      "email": "maria.lopez@riverside-properties.com",
      "phone": "+1-555-014-2201",
      "first_name": "Maria",
      "last_name": "Lopez"
    }
  ],
  "meta": {
    "mode": "search",
    "q": "McCarthy",
    "search_column": "name",
    "search_operator": "contains",
    "count": 47,
    "page": 1,
    "limit": 20,
    "total_pages": 3,
    "has_more": true
  }
}
```

`meta.count` is the **total** rows matching the filter (not just this page). Use `total_pages` and `has_more` to build pagination UI.

---

## 8. `users` (lookup)

Search **`auth.users`** (assignees synced from GHL). Same filter pattern as `contacts`.

### Autocomplete

```json
{
  "action": "users",
  "q": "sar",
  "limit": 20,
  "filters": { "autocomplete": true }
}
```

### Column search

```json
{
  "action": "users",
  "page": 1,
  "q": "McCarthy",
  "limit": 20,
  "filters": {
    "search_column": "name",
    "search_operator": "contains"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (1-based) |
| `limit` | number | `20` | Page size (max 100) |
| `q` | string | `""` | Search term |

| `filters` field | Type | Description |
|-----------------|------|-------------|
| `autocomplete` | boolean | `true` → prefix search on display name |
| `search_column` | string | `name` (default) or `email` |
| `search_operator` | string | `starts_with` \| `contains` \| `ends_with` \| `equal` (default `contains`) |

### Response

```json
{
  "success": true,
  "action": "users",
  "data": [
    {
      "id": "auth-user-uuid",
      "display_name": "Robert McCarthy",
      "email": "robert@example.com",
      "initials": "RM",
      "user_metadata": {
        "ghl_id": "GHL_USER_ID",
        "first_name": "Robert",
        "last_name": "McCarthy"
      }
    }
  ],
  "meta": {
    "mode": "search",
    "q": "McCarthy",
    "search_column": "name",
    "search_operator": "contains",
    "count": 5,
    "page": 1,
    "limit": 20,
    "total_pages": 1,
    "has_more": false
  }
}
```

Same pagination fields as `contacts`: `count` = total matches, `total_pages` = `ceil(count / limit)`.

Uses **Auth Admin API** (not SQL on `auth.users`) so `user_metadata` from GHL sync (`ghl_id`, `first_name`, `last_name`) is always present. Empty `q` with search filters returns all users (paginated).

Use returned `id` values in `list` filters: `filters.assign` (UUID array).

---

## Tags database schema

See `supabase/migrations/20260520120000_tags.sql`:

| Table / function | IDs |
|------------------|-----|
| `public.tags` | **integer** `id` (identity), unique `name` |
| `public.task_tags` | **integer** `task_id` → `tasks.id`, **integer** `tag_id` → `tags.id` |
| `public.search_tags(prefix, limit)` | returns `(id int, name text)` |
| `public.sync_tags_from_tasks()` | inserts tag names + `task_tags` rows from `tasks.tags` jsonb |

Tasks still store tags on `tasks.tags` (jsonb) from GHL sync; the catalog powers autocomplete and `task_tags` links tasks to catalog rows.
