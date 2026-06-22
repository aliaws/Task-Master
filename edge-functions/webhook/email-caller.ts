import { sql } from "./email-db.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function displayNameFromAuthUser(user: {
  email?: string | null;
  raw_user_meta_data?: Record<string, unknown> | null;
}) {
  const meta = user?.raw_user_meta_data ?? {};
  const first = String(meta.first_name ?? meta.firstName ?? "").trim();
  const last = String(meta.last_name ?? meta.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = user?.email ?? "";
  return email.includes("@") ? email.split("@")[0] : email || "Someone";
}

export type TaskCaller = {
  id: string | null;
  name: string;
  email: string | null;
};

const FALLBACK_CALLER: TaskCaller = {
  id: null,
  name: "Someone",
  email: null,
};

/** Resolve display name from tasks.last_changed_by_user_id (DB webhook record). */
export async function resolveCallerFromUserId(
  userId: unknown
): Promise<TaskCaller> {
  if (userId == null || userId === "") {
    return FALLBACK_CALLER;
  }

  const id = String(userId).trim();
  if (!UUID_RE.test(id)) {
    return FALLBACK_CALLER;
  }

  const rows = await sql`
    SELECT id, email, raw_user_meta_data
    FROM auth.users
    WHERE id = ${id}
    LIMIT 1
  `;

  if (!rows[0]) {
    return FALLBACK_CALLER;
  }

  return {
    id: rows[0].id,
    name: displayNameFromAuthUser(rows[0]),
    email: rows[0].email ?? null,
  };
}
