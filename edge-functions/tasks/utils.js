export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const JSON_HEADERS = {
  ...CORS_HEADERS,
  "Content-Type": "application/json",
};

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

/** Preflight for browser clients (same as password-validate-send-otp). */
export function corsPreflightResponse() {
  return new Response("ok", { headers: CORS_HEADERS });
}

export function formatHMS(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours} hour, ${minutes} minutes, ${secs} seconds`;
}

/** "John Doe" -> "JD", "Madonna" -> "M" */
export function initialsFromDisplayName(displayName) {
  if (!displayName || typeof displayName !== "string") return null;

  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }

  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function buildAssignee(row) {
  if (!row?.assigned_id) return null;

  const displayName = row.assignee_display_name || null;

  return {
    id: row.assigned_id,
    display_name: displayName,
    initials: initialsFromDisplayName(displayName),
  };
}

export function buildContact(row) {
  if (!row?.contact_id) return null;

  return {
    id: row.contact_id,
    name: row.contact_name || null,
    email: row.contact_email || null,
  };
}

export function buildStatus(row) {
  if (!row?.status_id) return null;

  return {
    id: row.status_id,
    name: row.status_name || null,
  };
}

/**
 * Short preview for cards/lists. Prefers first clause (before comma);
 * otherwise trims at word boundary (~80 chars) and adds "..".
 */
export function truncateDescription(text, maxLen = 80) {
  if (text == null || text === "") return null;

  const trimmed = String(text).trim();
  if (!trimmed) return null;

  const commaAt = trimmed.indexOf(",");
  if (commaAt > 20 && commaAt <= 200) {
    return `${trimmed.slice(0, commaAt).trim()}..`;
  }

  if (trimmed.length <= maxLen) return trimmed;

  let cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.5) {
    cut = cut.slice(0, lastSpace);
  }
  return `${cut.trim()}..`;
}

/** Same shape as kanban: seconds + human-readable string. */
export function buildTimeSpent(row) {
  const time_spent = Number(row?.time_spent ?? 0);
  return {
    time_spent,
    time_spent_in_words: formatHMS(time_spent),
  };
}

export function parsePagination(body) {
  const page = Math.max(1, Number(body.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

const SORT_COLUMNS = {
  created_at: "tb.created_at",
  updated_at: "tb.updated_at",
  due_date: "tb.due_date",
  priority: "tb.priority",
  title: "tb.title",
};

export function parseSort(body) {
  const sortBy = SORT_COLUMNS[body.sort_by] ? body.sort_by : "created_at";
  const order = body.order === "ASC" ? "ASC" : "DESC";

  return { sortBy, order, column: SORT_COLUMNS[sortBy] };
}

export function paginationMeta({ count, page, limit, sortBy, order }) {
  const totalPages = count > 0 ? Math.ceil(count / limit) : 0;

  return {
    count,
    page,
    limit,
    total_pages: totalPages,
    has_more: page < totalPages,
    sort_by: sortBy,
    order,
  };
}
