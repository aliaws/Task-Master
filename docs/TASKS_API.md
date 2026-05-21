# Tasks API

Single edge function **`tasks`** exposes board, list, detail, and tag autocomplete actions via **POST**. Use **`action`** in the JSON body or query string (`?action=list`). Default action is **`kanban`**.

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

## 1. `kanban` (unchanged)

Board columns keyed by `task_boards.name`. Same POST shape as before.

### Body

```json
{
  "action": "kanban",
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "status_id": null,
  "filters": {
    "priority": { "value": "High" }
  }
}
```

| Field | Description |
|-------|-------------|
| `status_id` | Optional single board id (number, legacy) |
| `filters` | Column → `{ "value": "..." }` (legacy kanban filters) |

### Response

Object keyed by board name; each column has `id`, `meta`, `data` (full task rows with `contact`, `time_spent`, etc.).

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
      "description": "…",
      "contact": { "id": "550e8400-...", "name": "Jane Doe", "email": "j@example.com" },
      "assigned_to": {
        "id": "auth-user-uuid",
        "display_name": "John Smith",
        "initials": "JS"
      },
      "due_date": "2026-05-19T17:00:00.000Z",
      "ghl_id": "EXWCtKrL6mvWOue5Uesc",
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

---

## 3. `task_detail`

Single task with subtasks, attachments, and tags.

### Body

```json
{
  "action": "task_detail",
  "id": 42
}
```

`task_id` is accepted as an alias for `id`.

### Response

Same fields as list, plus:

```json
{
  "subtasks": [],
  "attachments": [],
  "tags": ["voice-ai", "follow-up"]
}
```

---

## 4. `boards`

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

## 5. `tags` (autocomplete)

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
