-- ── Tag links: match by title keywords (adjust if your titles differ) ────────
INSERT INTO public.task_tags (task_id, tag_id)
SELECT DISTINCT t.id, tg.id
FROM public.tasks t
INNER JOIN public.tags tg ON tg.name = 'follow-up'
WHERE t.title ILIKE '%follow%' OR t.title ILIKE '%call back%'
ON CONFLICT (task_id, tag_id) DO NOTHING;

INSERT INTO public.task_tags (task_id, tag_id)
SELECT DISTINCT t.id, tg.id
FROM public.tasks t
INNER JOIN public.tags tg ON tg.name = 'voice-ai'
WHERE t.title ILIKE '%AI%' OR t.description ILIKE '%voice%'
ON CONFLICT (task_id, tag_id) DO NOTHING;

INSERT INTO public.task_tags (task_id, tag_id)
SELECT DISTINCT t.id, tg.id
FROM public.tasks t
INNER JOIN public.tags tg ON tg.name = 'scheduling'
WHERE t.title ILIKE '%schedule%' OR t.title ILIKE '%appointment%'
ON CONFLICT (task_id, tag_id) DO NOTHING;

INSERT INTO public.task_tags (task_id, tag_id)
SELECT DISTINCT t.id, tg.id
FROM public.tasks t
INNER JOIN public.tags tg ON tg.name = 'hot-lead'
WHERE t.priority = 'High'
ON CONFLICT (task_id, tag_id) DO NOTHING;

INSERT INTO public.task_tags (task_id, tag_id)
SELECT DISTINCT t.id, tg.id
FROM public.tasks t
INNER JOIN public.tags tg ON tg.name = 'warranty'
WHERE t.title ILIKE '%warranty%' OR t.description ILIKE '%warranty%'
ON CONFLICT (task_id, tag_id) DO NOTHING;

INSERT INTO public.task_tags (task_id, tag_id)
SELECT DISTINCT t.id, tg.id
FROM public.tasks t
INNER JOIN public.tags tg ON tg.name = 'urgent'
WHERE t.priority = 'High' AND t.due_date IS NOT NULL AND t.due_date < now() + interval '2 days'
ON CONFLICT (task_id, tag_id) DO NOTHING;

-- Spread a few generic tags on recent tasks for UI variety
INSERT INTO public.task_tags (task_id, tag_id)
SELECT t.id, tg.id
FROM (
  SELECT id FROM public.tasks ORDER BY updated_at DESC NULLS LAST LIMIT 12
) t
CROSS JOIN public.tags tg
WHERE tg.name IN ('nurture', 'estimate-sent', 'callback-requested')
ON CONFLICT (task_id, tag_id) DO NOTHING;

-- Keep tasks.tags jsonb in sync for list/detail that read jsonb
UPDATE public.tasks t
SET tags = sub.tag_names
FROM (
  SELECT
    tt.task_id,
    COALESCE(jsonb_agg(tg.name ORDER BY tg.name), '[]'::jsonb) AS tag_names
  FROM public.task_tags tt
  INNER JOIN public.tags tg ON tg.id = tt.tag_id
  GROUP BY tt.task_id
) sub
WHERE t.id = sub.task_id;
