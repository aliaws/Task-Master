begin
  return (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = id_name
  );
end;
