# Webhook API (Postman / Database Webhooks)

**URL:** `POST https://{{SUPABASE_ID}}.supabase.co/functions/v1/webhook`

## Headers

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer {{SERVICE_ROLE_KEY}}` |
| `apikey` | `{{SERVICE_ROLE_KEY}}` |
| `x-webhook-secret` | Optional — only if `WEBHOOK_SECRET` is set on the function |

## Incoming body (trigger only needs `id`)

The function **loads the row from the database** and builds a **GHL-only** payload in `edge-functions/webhook/ghl-payloads.ts`.

```json
{
  "type": "INSERT",
  "table": "tasks",
  "record": { "id": 42, "data_source": "task_master" },
  "old_record": null
}
```

`data_source` is **label only** (`engage` = from GHL import, `task_master` = created in app). Webhook **always pushes** to GHL on real field changes. Do **not** send full DB columns to GHL — only `record.id` is required.

## What GHL receives (edit in `ghl-payloads.ts`)

### Task create `POST /contacts/:contactId/tasks`

```json
{
  "title": "First Task",
  "body": "description text",
  "dueDate": "2020-10-25T11:00:00.000Z",
  "completed": false,
  "assignedTo": "hxHGVRb1YJUscrCB8eXK"
}
```

| DB column | GHL field |
|-----------|-----------|
| `title` | `title` |
| `description` | `body` |
| `due_date` | `dueDate` |
| `status_id` → `task_boards.is_completed` | `completed` |
| `assigned_to` → `user_metadata.ghl_id` | `assignedTo` |

### Task update `PUT /contacts/:contactId/tasks/:taskId`

Same fields; `dueDate` omitted if empty.

### Contact create `POST /contacts/`

```json
{
  "locationId": "from vault",
  "firstName": "Robert",
  "lastName": "McCarthy",
  "email": "a@b.com",
  "phone": "+1..."
}
```

### Contact update `PUT /contacts/:contactId`

`firstName`, `lastName`, `email`, `phone` only — **no** `locationId`.

## Success response

```json
{
  "success": true,
  "request_id": "uuid",
  "status": "completed",
  "ghl_id": "...",
  "action": "created",
  "ghl_method": "POST",
  "ghl_path": "/contacts/.../tasks",
  "ghl_payload": { }
}
```

`ghl_payload` is exactly what was sent to GHL.

## Audit

```sql
SELECT * FROM public.webhooks ORDER BY created_at DESC LIMIT 10;
```
