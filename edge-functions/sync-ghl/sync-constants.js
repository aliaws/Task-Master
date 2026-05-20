/** Shared checkpoint keys and batch sizes for GHL sync. */

export const CHECKPOINT_KEY_CONTACT = "ghl_contact_sync";
export const CHECKPOINT_KEY_TASK = "ghl_task_sync";

export const GHL_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

export const CONTACT_PAGE_LIMIT = 100;
export const TASK_CONTACT_BATCH_SIZE = 50;

export const TASK_STATUS_MAP = {
  true: 4,
  false: 1,
};

export const SYNC_MODES = ["contacts", "tasks", "all"];
