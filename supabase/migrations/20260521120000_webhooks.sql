-- Outbound GHL sync audit log (started + completed rows per request).

CREATE TABLE IF NOT EXISTS public.webhooks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('contact', 'task', 'user')),
  entity_id text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'skipped')),
  ghl_id text,
  payload jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhooks_request_id_idx ON public.webhooks (request_id);
CREATE INDEX IF NOT EXISTS webhooks_entity_idx
  ON public.webhooks (entity_type, entity_id, created_at DESC);

-- Loop guard: inbound sync sets data_source = 'engage'; Task Master edits use 'task_master'.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS data_source text;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS data_source text;

COMMENT ON TABLE public.webhooks IS
  'Audit trail for outbound GHL pushes. Each run inserts started then completed/failed/skipped.';
COMMENT ON COLUMN public.contacts.data_source IS
  'engage = from GHL/sync (skip outbound webhook); task_master = push to GHL on change.';
COMMENT ON COLUMN public.tasks.data_source IS
  'engage = from GHL/sync (skip outbound webhook); task_master = push to GHL on change.';
