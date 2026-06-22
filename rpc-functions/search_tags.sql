
  SELECT t.id, t.name
  FROM public.tags t
  WHERE prefix IS NULL
     OR trim(prefix) = ''
     OR lower(t.name) LIKE lower(trim(prefix)) || '%'
  ORDER BY t.name
  LIMIT GREATEST(1, LEAST(COALESCE(result_limit, 20), 100));
