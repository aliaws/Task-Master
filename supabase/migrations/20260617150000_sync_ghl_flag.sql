-- Add enable_ghl_sync flag to contacts and tasks.
-- true  = sync to GHL (default)
-- false = skip GHL sync

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS enable_ghl_sync boolean NOT NULL DEFAULT true;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS enable_ghl_sync boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.contacts.enable_ghl_sync IS 'If true, push changes to GHL.';
COMMENT ON COLUMN public.tasks.enable_ghl_sync IS 'If true, push changes to GHL.';
