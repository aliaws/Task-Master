export { deleteContactFromGhl, pushContactToGhl } from "./push-contact.ts";
export { deleteTaskFromGhl, pushTaskToGhl } from "./push-task.ts";

/** GHL users: inbound sync only (v1). */
export async function pushUserToGhl(record: Record<string, unknown>) {
  const ghlId = record.ghl_id as string | undefined;
  if (!ghlId) {
    return {
      skipped: true,
      reason: "User has no ghl_id; run sync-ghl?sync=users first",
    };
  }

  return {
    skipped: true,
    ghl_id: ghlId,
    reason: "GHL users are not updated outbound in v1",
  };
}
