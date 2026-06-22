
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
