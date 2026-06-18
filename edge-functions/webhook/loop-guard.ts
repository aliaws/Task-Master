/** Skip outbound when only bookkeeping / display-order fields changed. */
const LOOP_GUARD_FIELDS = new Set(["ghl_id", "updated_at", "task_order", "enable_ghl_sync"]);

/** Skip task change log when only GHL sync bookkeeping fields changed. */
const BOOKKEEPING_FIELDS = new Set(["ghl_id", "updated_at"]);

function onlyFieldsChanged(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown>,
  allowed: Set<string>
) {
  const changed = Object.keys(record).filter((k) => record[k] !== oldRecord[k]);
  return changed.length > 0 && changed.every((k) => allowed.has(k));
}

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

  if (onlyFieldsChanged(record, oldRecord, LOOP_GUARD_FIELDS)) {
    return {
      skip: true,
      reason: "only bookkeeping fields changed",
    };
  }

  return { skip: false };
}

/** Log task changes unless only ghl_id/updated_at bookkeeping changed. */
export function shouldSkipTaskChangeLog(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
): { skip: boolean; reason?: string } {
  if (!oldRecord) {
    return { skip: true, reason: "no old_record (insert)" };
  }
  if (onlyFieldsChanged(record, oldRecord, BOOKKEEPING_FIELDS)) {
    return {
      skip: true,
      reason: "only bookkeeping fields changed",
    };
  }
  return { skip: false };
}
