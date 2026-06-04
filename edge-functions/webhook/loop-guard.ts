import {
  DATA_SOURCE_ENGAGE,
  DATA_SOURCE_TASK_MASTER,
} from "./data-source.ts";

const SYNC_METADATA_FIELDS = new Set([
  "ghl_id",
  "data_source",
  "updated_at",
  "ghl_date_updated",
  "total_tasks",
]);

/** Skip outbound push unless the row is from Task Master (`task_master`). */
export function shouldSkipOutbound(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
): { skip: boolean; reason?: string } {
  const source = record.data_source;

  if (source === DATA_SOURCE_ENGAGE) {
    return {
      skip: true,
      reason: "data_source is engage — row already in Engage, no push",
    };
  }

  if (source !== DATA_SOURCE_TASK_MASTER) {
    return {
      skip: true,
      reason: `only data_source task_master is pushed (got ${source ?? "null"})`,
    };
  }

  if (!oldRecord) {
    return { skip: false };
  }

  const changed = Object.keys(record).filter(
    (k) => record[k] !== oldRecord[k]
  );

  const onlySyncMetadata = changed.length > 0 &&
    changed.every((k) => SYNC_METADATA_FIELDS.has(k));

  if (onlySyncMetadata) {
    return { skip: true, reason: "only sync metadata changed (ghl_id, data_source, etc.)" };
  }

  return { skip: false };
}
