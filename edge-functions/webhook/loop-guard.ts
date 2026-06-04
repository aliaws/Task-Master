/** Fields updated after a successful GHL push — skip only this to avoid webhook loop. */
const LOOP_GUARD_FIELDS = new Set(["ghl_id", "updated_at"]);

/**
 * Always push task/contact changes to GHL.
 * data_source (engage | task_master) is label-only — not used to skip.
 */
export function shouldSkipOutbound(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
): { skip: boolean; reason?: string } {
  if (!oldRecord) {
    return { skip: false };
  }

  const changed = Object.keys(record).filter(
    (k) => record[k] !== oldRecord[k]
  );

  const onlyLoopFields = changed.length > 0 &&
    changed.every((k) => LOOP_GUARD_FIELDS.has(k));

  if (onlyLoopFields) {
    return {
      skip: true,
      reason: "only ghl_id/updated_at changed (post-sync bookkeeping)",
    };
  }

  return { skip: false };
}
