CREATE TRIGGER trg_contacts_set_timestamps
BEFORE INSERT OR UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION set_timestamps();