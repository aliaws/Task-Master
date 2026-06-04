import { GHL_API_VERSION, GHL_BASE_URL } from "./ghl-client.ts";

export async function ghlFetch(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Version", GHL_API_VERSION);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${GHL_BASE_URL}${path}`, { ...init, headers });
}

export async function ghlJsonOrThrow(
  res: Response,
  context: string
): Promise<Record<string, unknown>> {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${context} (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

export function extractGhlTaskId(data: Record<string, unknown>): string | null {
  const task = data.task as { id?: string } | undefined;
  if (task?.id) return String(task.id);
  if (typeof data.id === "string") return data.id;
  return null;
}

export function extractGhlContactId(data: Record<string, unknown>): string | null {
  const contact = data.contact as { id?: string } | undefined;
  if (contact?.id) return String(contact.id);
  if (typeof data.id === "string") return data.id;
  return null;
}
