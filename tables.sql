-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text,
  phone text,
  created_at timestamp without time zone DEFAULT now(),
  first_name text,
  last_name text,
  ghl_id text UNIQUE,
  updated_at timestamp with time zone,
  ghl_date_updated timestamp with time zone,
  total_tasks integer DEFAULT 0,
  data_source text,
  enable_ghl_sync boolean NOT NULL DEFAULT true,
  CONSTRAINT contacts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.tasks (
  id integer NOT NULL DEFAULT nextval('tasks_id_seq'::regclass),
  title character varying NOT NULL,
  description text,
  priority USER-DEFINED DEFAULT 'Medium'::task_priority,
  tags jsonb DEFAULT '[]'::jsonb,
  subtasks jsonb DEFAULT '[]'::jsonb,
  attachments ARRAY DEFAULT '{}'::text[],
  contact_id uuid DEFAULT gen_random_uuid(),
  due_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  ghl_id text UNIQUE,
  status_id integer,
  assigned_to uuid DEFAULT gen_random_uuid(),
  data_source USER-DEFINED DEFAULT 'engage'::source,
  time_start_at timestamp with time zone,
  last_changed_by_user_id uuid,
  task_order integer NOT NULL DEFAULT 0,
  enable_ghl_sync boolean NOT NULL DEFAULT true,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT fk_task_status FOREIGN KEY (status_id) REFERENCES public.task_boards(id)
);
CREATE TABLE public.engage_tokens (
  id integer NOT NULL DEFAULT nextval('engage_tokens_id_seq'::regclass),
  auth_code character varying UNIQUE,
  refresh_token text NOT NULL UNIQUE,
  access_token text NOT NULL UNIQUE,
  expiry bigint NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scope text,
  CONSTRAINT engage_tokens_pkey PRIMARY KEY (id)
);
CREATE TABLE public.task_boards (
  id integer NOT NULL DEFAULT nextval('task_board_status_id_seq'::regclass),
  name character varying NOT NULL,
  sort_order integer NOT NULL,
  is_completed boolean NOT NULL DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT task_boards_pkey PRIMARY KEY (id)
);
CREATE TABLE public.task_sessions (
  id bigint NOT NULL DEFAULT nextval('task_sessions_id_seq'::regclass),
  task_id bigint NOT NULL,
  duration_seconds bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  type USER-DEFINED DEFAULT 'TRACKED'::"TASK SESSION TYPES",
  updated_by uuid,
  updated_at timestamp with time zone,
  CONSTRAINT task_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT task_sessions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id)
);
CREATE TABLE public.sync_checkpoints (
  key text NOT NULL UNIQUE,
  last_page integer DEFAULT 0,
  total_saved_contacts integer DEFAULT 0,
  total_saved_tasks integer DEFAULT 0,
  last_cursor character varying,
  updated_at timestamp with time zone DEFAULT now(),
  total_available_contacts integer DEFAULT 0,
  total_contacts_processed integer DEFAULT 0,
  CONSTRAINT sync_checkpoints_pkey PRIMARY KEY (key)
);
CREATE TABLE public.tags (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tags_pkey PRIMARY KEY (id)
);
CREATE TABLE public.task_tags (
  task_id integer NOT NULL,
  tag_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_tags_pkey PRIMARY KEY (task_id, tag_id),
  CONSTRAINT task_tags_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id)
);
CREATE TABLE public.webhooks (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type = ANY (ARRAY['contact'::text, 'task'::text, 'user'::text])),
  entity_id text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text, 'skipped'::text])),
  ghl_id text,
  payload jsonb,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webhooks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.trusted_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_hash text NOT NULL,
  device_name text,
  registered_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  last_used_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT trusted_devices_pkey PRIMARY KEY (id),
  CONSTRAINT trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.country_codes (
  id smallint GENERATED ALWAYS AS IDENTITY NOT NULL,
  iso2 character NOT NULL UNIQUE,
  dial_code text NOT NULL UNIQUE,
  name text NOT NULL,
  flag_emoji text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT country_codes_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_profiles (
  user_id uuid NOT NULL,
  country_code_id smallint,
  phone_local text,
  phone text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_profiles_country_code_id_fkey FOREIGN KEY (country_code_id) REFERENCES public.country_codes(id),
  CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.email_templates (
  template_key text NOT NULL CHECK (template_key = ANY (ARRAY['priority_changed'::text, 'assigned_to_changed'::text, 'due_date_changed'::text, 'status_changed'::text, 'mention'::text])),
  subject_template text NOT NULL,
  body_html_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT email_templates_pkey PRIMARY KEY (template_key)
);
CREATE TABLE public.task_change_logs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id integer NOT NULL,
  email_template_key text CHECK (email_template_key IS NULL OR (email_template_key = ANY (ARRAY['priority_changed'::text, 'assigned_to_changed'::text, 'due_date_changed'::text, 'status_changed'::text, 'mention'::text]))),
  field_name text NOT NULL,
  old_display_value text,
  new_display_value text,
  changed_by_user_id uuid,
  changed_by_name text,
  recipient_email text,
  email_subject text,
  email_provider_message_id text,
  email_status text NOT NULL DEFAULT 'not_applicable'::text CHECK (email_status = ANY (ARRAY['not_applicable'::text, 'pending'::text, 'sent'::text, 'delivered'::text, 'opened'::text, 'bounced'::text, 'failed'::text, 'skipped'::text])),
  email_error_message text,
  email_sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_viewed boolean NOT NULL DEFAULT false,
  viewed_at timestamp with time zone,
  old_value jsonb,
  new_value jsonb,
  CONSTRAINT task_change_logs_pkey PRIMARY KEY (id),
  CONSTRAINT email_notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id)
);
CREATE TABLE public.task_comments (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  task_id integer NOT NULL,
  user_id uuid,
  display_name text NOT NULL DEFAULT ''::text,
  initials text,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  parent_id integer,
  CONSTRAINT task_comments_pkey PRIMARY KEY (id),
  CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.task_comments(id)
);


DROP TRIGGER IF EXISTS trg_set_updated_at ON contacts;

CREATE TRIGGER trg_set_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION set_timestamps();

Truncate contacts cascade;


DROP TRIGGER IF EXISTS trg_set_timestamps ON contacts;

CREATE TRIGGER trg_contacts_set_timestamps
BEFORE INSERT OR UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION set_timestamps();

DROP TRIGGER IF EXISTS trg_set_timestamps ON engage_tokens;


CREATE TRIGGER trg_engage_tokens_set_timestamps
BEFORE INSERT OR UPDATE ON engage_tokens
FOR EACH ROW
EXECUTE FUNCTION set_timestamps();


CREATE TABLE public.trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  device_name text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);

CREATE INDEX trusted_devices_user_expires_idx
  ON public.trusted_devices (user_id, expires_at);

ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
-- No client policies — edge function uses service role only

Select * from task_sessions where task_id = 785;

Select count(*) from webhooks;

truncate webhooks;

Select count(*) from webhooks