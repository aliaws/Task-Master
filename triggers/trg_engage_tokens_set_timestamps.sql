CREATE TRIGGER trg_engage_tokens_set_timestamps
BEFORE INSERT OR UPDATE ON engage_tokens
FOR EACH ROW
EXECUTE FUNCTION set_timestamps();