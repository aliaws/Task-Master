 SELECT COALESCE(SUM(duration_seconds), 0)
  FROM task_sessions
  WHERE task_id = p_task_id;
