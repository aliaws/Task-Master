const GHL_ONLY_FIELDS = new Set([
  "ghl_id",
  "data_source",
  "updated_at",
  "ghl_date_updated",
  "total_tasks",
]);

/** Skip outbound push when row came from GHL or we only wrote sync metadata. */
export function shouldSkipOutbound(
  record: Record<string, unknown>,
  oldRecord: Record<string, unknown> | null
): { skip: boolean; reason?: string } {
  if (record.data_source === "ghl") {
    return { skip: true, reason: "data_source is ghl (inbound sync)" };
  }

  if (!oldRecord) {
    return { skip: false };
  }

  const changed = Object.keys(record).filter(
    (k) => record[k] !== oldRecord[k]
  );

  const onlyMeta = changed.length > 0 &&
    changed.every((k) => GHL_ONLY_FIELDS.has(k));

  if (onlyMeta) {
    return { skip: true, reason: "only ghl sync metadata changed" };
  }

  return { skip: false };
}
