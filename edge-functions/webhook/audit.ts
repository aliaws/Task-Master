import { supabase } from "./ghl-client.ts";

export type EntityType = "contact" | "task" | "user";
export type AuditStatus = "started" | "completed" | "failed" | "skipped";

export async function logWebhookEvent(opts: {
  requestId: string;
  entityType: EntityType;
  entityId: string;
  eventType: string;
  status: AuditStatus;
  ghlId?: string | null;
  payload?: unknown;
  errorMessage?: string | null;
}) {
  const { error } = await supabase.from("webhooks").insert({
    request_id: opts.requestId,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    event_type: opts.eventType,
    status: opts.status,
    ghl_id: opts.ghlId ?? null,
    payload: opts.payload ?? null,
    error_message: opts.errorMessage ?? null,
  });

  if (error) throw new Error(`webhooks audit insert failed: ${error.message}`);
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
