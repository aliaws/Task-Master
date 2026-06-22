
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.last_changed_by_user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
