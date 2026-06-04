/** Inbound from GHL / sync-ghl — skip outbound webhook. */
export const DATA_SOURCE_ENGAGE = "engage";

/** Created or edited in Task Master — push to GHL on change. */
export const DATA_SOURCE_TASK_MASTER = "task_master";

/** Legacy values (still skipped on outbound if present in DB). */
export const LEGACY_DATA_SOURCE_GHL = "ghl";
export const LEGACY_DATA_SOURCE_APP = "app";

export function isEngageSource(dataSource: unknown): boolean {
  return (
    dataSource === DATA_SOURCE_ENGAGE || dataSource === LEGACY_DATA_SOURCE_GHL
  );
}

export function isTaskMasterSource(dataSource: unknown): boolean {
  return (
    dataSource === DATA_SOURCE_TASK_MASTER ||
    dataSource === LEGACY_DATA_SOURCE_APP
  );
}
