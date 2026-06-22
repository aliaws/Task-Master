/**
 * GHL API payloads only — edit mappings here.
 * https://marketplace.gohighlevel.com/docs/ghl/contacts/create-task
 * https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
 */

/** POST /contacts/ */
export type GhlContactCreatePayload = {
  locationId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

/** PUT /contacts/:contactId */
export type GhlContactUpdatePayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

/** POST /contacts/:contactId/tasks */
export type GhlTaskCreatePayload = {
  title: string;
  body?: string;
  dueDate: string;
  completed: boolean;
  assignedTo?: string;
};

/** PUT /contacts/:contactId/tasks/:taskId */
export type GhlTaskUpdatePayload = {
  title?: string;
  body?: string;
  dueDate?: string;
  completed?: boolean;
  assignedTo?: string;
};

export type DbContactRow = {
  id: string;
  ghl_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  data_source?: string | null;
};

export type DbTaskRow = {
  id: number;
  title?: string | null;
  description?: string | null;
  due_date?: string | null;
  status_id?: number | null;
  assigned_to?: string | null;
  ghl_id?: string | null;
  contact_id?: string | null;
  data_source?: string | null;
  contact_ghl_id?: string | null;
};

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

export function formatGhlDueDate(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function defaultGhlDueDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(17, 0, 0, 0);
  return d.toISOString();
}

/** Drop null/undefined/empty — GHL must not receive DB junk. */
export function serializeGhlPayload(payload: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return JSON.stringify(out);
}

export function buildGhlContactCreatePayload(
  row: DbContactRow,
  locationId: string
): GhlContactCreatePayload {
  if (!locationId) throw new Error("locationId is required for GHL contact create");

  return {
    locationId,
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    email: str(row.email),
    phone: str(row.phone),
  };
}

export function buildGhlContactUpdatePayload(
  row: DbContactRow
): GhlContactUpdatePayload {
  return {
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    email: str(row.email),
    phone: str(row.phone),
  };
}

export function buildGhlTaskCreatePayload(
  row: DbTaskRow,
  completed: boolean,
  assignedToGhl?: string
): GhlTaskCreatePayload {
  const title = str(row.title);
  if (!title) throw new Error("Task title is required for GHL create");

  const payload: GhlTaskCreatePayload = {
    title,
    dueDate: formatGhlDueDate(row.due_date) ?? defaultGhlDueDate(),
    completed,
  };

  const body = str(row.description);
  if (body) payload.body = body;

  if (assignedToGhl) payload.assignedTo = assignedToGhl;

  return payload;
}

export function buildGhlTaskUpdatePayload(
  row: DbTaskRow,
  completed: boolean,
  assignedToGhl?: string
): GhlTaskUpdatePayload {
  const title = str(row.title);
  if (!title) throw new Error("Task title is required for GHL update");

  const payload: GhlTaskUpdatePayload = {
    title,
    completed,
  };

  const body = str(row.description);
  if (body) payload.body = body;

  const dueDate = formatGhlDueDate(row.due_date);
  if (dueDate) payload.dueDate = dueDate;

  if (assignedToGhl) payload.assignedTo = assignedToGhl;

  return payload;
}
