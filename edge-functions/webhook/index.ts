import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { logWebhookEvent, newRequestId } from "./audit.ts";
import { handleTaskEmailFromDbWebhook } from "./email-notify.ts";
import { pushContactToGhl, pushUserToGhl } from "./handlers.ts";
import { pushTaskToGhl } from "./push-task.ts";
import { shouldSkipOutbound } from "./loop-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function verifySecret(req: Request): boolean {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret) return true;
  const header = req.headers.get("x-webhook-secret") ?? "";
  return header === secret;
}

type DbWebhookPayload = {
  type?: string;
  table?: string;
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown> | null;
};

const TABLE_ENTITY = {
  contacts: "contact",
  tasks: "task",
  users: "user",
} as const;

async function runPush(
  entityType: "contact" | "task" | "user",
  eventType: string,
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
) {
  const requestId = newRequestId();
  const entityId = String(record.id ?? "");

  await logWebhookEvent({
    requestId,
    entityType,
    entityId,
    eventType,
    status: "started",
    payload: { entity_id: entityId, event_type: eventType },
  });

  const guard = shouldSkipOutbound(record, oldRecord);
  if (guard.skip) {
    await logWebhookEvent({
      requestId,
      entityType,
      entityId,
      eventType,
      status: "skipped",
      ghlId: record.ghl_id as string | undefined,
      errorMessage: guard.reason,
    });
    return { request_id: requestId, status: "skipped", reason: guard.reason };
  }

  try {
    let result: Record<string, unknown>;

    if (entityType === "contact") {
      result = await pushContactToGhl({ id: record.id });
    } else if (entityType === "task") {
      result = await pushTaskToGhl({ id: record.id });
    } else {
      result = await pushUserToGhl(record);
    }

    if (result.skipped) {
      await logWebhookEvent({
        requestId,
        entityType,
        entityId,
        eventType,
        status: "skipped",
        errorMessage: String(result.reason ?? "skipped"),
      });
      return { request_id: requestId, status: "skipped", ...result };
    }

    await logWebhookEvent({
      requestId,
      entityType,
      entityId,
      eventType,
      status: "completed",
      ghlId: String(result.ghl_id ?? record.ghl_id ?? ""),
      payload: result,
    });

    return { request_id: requestId, status: "completed", ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await logWebhookEvent({
      requestId,
      entityType,
      entityId,
      eventType,
      status: "failed",
      ghlId: record.ghl_id as string | undefined,
      errorMessage: message,
    });

    throw err;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!verifySecret(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: DbWebhookPayload & { entity?: string; record?: Record<string, unknown> };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const table = (body.table ?? body.entity ?? "").toLowerCase();
  const eventType = body.type ?? "MANUAL";
  const record = body.record;

  if (!record?.id) {
    return json({ error: "Missing record.id in payload" }, 400);
  }

  const entityType = TABLE_ENTITY[table as keyof typeof TABLE_ENTITY];
  if (!entityType) {
    return json(
      {
        error: `Unsupported table "${table}". Use contacts, tasks, or users.`,
      },
      400
    );
  }

  if (eventType === "DELETE") {
    const requestId = newRequestId();
    await logWebhookEvent({
      requestId,
      entityType,
      entityId: String(record.id),
      eventType,
      status: "skipped",
      errorMessage: "DELETE not pushed to GHL in v1",
    });
    return json({ request_id: requestId, status: "skipped", reason: "DELETE not supported" });
  }

  let ghlResult: Record<string, unknown>;
  let ghlError: string | null = null;

  try {
    ghlResult = await runPush(
      entityType,
      eventType,
      record,
      body.old_record ?? null
    );
  } catch (err) {
    ghlError = err instanceof Error ? err.message : String(err);
    ghlResult = { status: "failed", error: ghlError };
  }

  let email: Record<string, unknown> | undefined;
  if (entityType === "task" && eventType === "UPDATE") {
    try {
      email = await handleTaskEmailFromDbWebhook(
        record,
        body.old_record ?? null
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("task email notification error:", message);
      email = { error: message };
    }
  }

  if (ghlError) {
    return json(
      {
        success: false,
        error: ghlError,
        ...ghlResult,
        ...(email !== undefined ? { email } : {}),
      },
      500
    );
  }

  return json({
    success: true,
    ...ghlResult,
    ...(email !== undefined ? { email } : {}),
  });
});
