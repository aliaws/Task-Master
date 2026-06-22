-- Tags catalog for autocomplete; integer PKs aligned with public.tasks (integer id).

CREATE TABLE IF NOT EXISTS public.tags (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS tags_name_lower_prefix_idx
  ON public.tags (lower(name) text_pattern_ops);

CREATE TABLE IF NOT EXISTS public.task_tags (
  task_id integer NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES public.tags (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, tag_id)
);

CREATE INDEX IF NOT EXISTS task_tags_tag_id_idx ON public.task_tags (tag_id);
CREATE INDEX IF NOT EXISTS task_tags_task_id_idx ON public.task_tags (task_id);

-- Prefix search for autocomplete UI.
CREATE OR REPLACE FUNCTION public.search_tags(prefix text, result_limit int DEFAULT 20)
RETURNS TABLE (id integer, name text)
LANGUAGE sql
STABLE
AS $$
  SELECT t.id, t.name
  FROM public.tags t
  WHERE prefix IS NULL
     OR trim(prefix) = ''
     OR lower(t.name) LIKE lower(trim(prefix)) || '%'
  ORDER BY t.name
  LIMIT GREATEST(1, LEAST(COALESCE(result_limit, 20), 100));
$$;

-- Seed tag names from tasks.tags jsonb and link task_tags rows.
CREATE OR REPLACE FUNCTION public.sync_tags_from_tasks()
RETURNS TABLE (tags_inserted int, links_inserted int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tags_inserted int;
  v_links_inserted int;
BEGIN
  INSERT INTO public.tags (name)
  SELECT DISTINCT trim(both '"' from elem::text)
  FROM public.tasks t,
       LATERAL jsonb_array_elements_text(COALESCE(t.tags, '[]'::jsonb)) AS elem
  WHERE trim(both '"' from elem::text) <> ''
  ON CONFLICT (name) DO NOTHING;

  GET DIAGNOSTICS v_tags_inserted = ROW_COUNT;

  INSERT INTO public.task_tags (task_id, tag_id)
  SELECT DISTINCT t.id, tg.id
  FROM public.tasks t
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(t.tags, '[]'::jsonb)) AS elem
  INNER JOIN public.tags tg
    ON tg.name = trim(both '"' from elem::text)
  WHERE trim(both '"' from elem::text) <> ''
  ON CONFLICT (task_id, tag_id) DO NOTHING;

  GET DIAGNOSTICS v_links_inserted = ROW_COUNT;

  tags_inserted := v_tags_inserted;
  links_inserted := v_links_inserted;
  RETURN NEXT;
END;
$$;
