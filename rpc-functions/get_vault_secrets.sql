declare
  result jsonb := '{}'::jsonb;
begin
  -- If names is NULL or empty -> return all
  if names is null or array_length(names, 1) is null then
    select coalesce(jsonb_object_agg(ds.name, ds.decrypted_secret), '{}'::jsonb)
      into result
    from vault.decrypted_secrets ds;
  else
    -- Otherwise return only requested names
    select coalesce(jsonb_object_agg(ds.name, ds.decrypted_secret), '{}'::jsonb)
      into result
    from vault.decrypted_secrets ds
    where ds.name = any(names);
  end if;

  return result;
end;
