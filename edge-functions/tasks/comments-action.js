import { sql } from "./db.js";
import { initialsFromDisplayName } from "./utils.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function displayNameFromAuthUser(user) {
  const meta = user?.raw_user_meta_data ?? {};
  const first = String(meta.first_name ?? "").trim();
  const last = String(meta.last_name ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = user?.email ?? "";
  return email.includes("@") ? email.split("@")[0] : email || "Someone";
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

function optionalString(value) {
  if (value == null || value === "") return null;
  return String(value).trim();
}

function requiredString(value, label) {
  const s = optionalString(value);
  if (!s) throw new Error(`${label} is required`);
  return s;
}

async function resolveCommentUser(userId) {
  if (!userId) return { display_name: null, initials: null };

  const id = String(userId).trim();
  if (!UUID_RE.test(id)) return { display_name: null, initials: null };

  const rows = await sql`
    SELECT id, email, raw_user_meta_data
    FROM auth.users
    WHERE id = ${id}
    LIMIT 1
  `;

  if (!rows.length) return { display_name: null, initials: null };

  const name = displayNameFromAuthUser(rows[0]);
  return { display_name: name, initials: initialsFromDisplayName(name) };
}

function mapComment(row) {
  return {
    id: row.id,
    content: row.content,
    user_id: row.user_id ?? null,
    display_name: row.display_name || null,
    initials: row.initials || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleCommentCreate(body) {
  const taskId = parsePositiveInt(body.task_id, "task_id");
  const content = requiredString(body.content, "content");

  const userId = body.user_id ? String(body.user_id).trim() : null;
  if (!userId) {
    throw new Error("user_id is required");
  }

  const resolved = await resolveCommentUser(userId);
  if (!resolved.display_name) {
    throw new Error("user_id must be a valid auth user UUID");
  }

  const rows = await sql`
    INSERT INTO public.task_comments (task_id, user_id, display_name, initials, content)
    VALUES (${taskId}, ${userId}, ${resolved.display_name}, ${resolved.initials}, ${content})
    RETURNING *
  `;

  return { data: mapComment(rows[0]) };
}

export async function handleCommentUpdate(body) {
  const id = parsePositiveInt(body.id, "id");
  const content = requiredString(body.content, "content");

  const rows = await sql`
    UPDATE public.task_comments
    SET content = ${content}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  if (!rows.length) {
    throw new Error(`Comment ${id} not found`);
  }

  return { data: mapComment(rows[0]) };
}

export async function handleCommentDelete(body) {
  const id = parsePositiveInt(body.id, "id");

  const rows = await sql`
    DELETE FROM public.task_comments
    WHERE id = ${id}
    RETURNING id
  `;

  if (!rows.length) {
    throw new Error(`Comment ${id} not found`);
  }

  return { deleted: true, id: rows[0].id };
}
