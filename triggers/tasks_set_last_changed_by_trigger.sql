CREATE TRIGGER tasks_set_last_changed_by_trigger
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION tasks_set_last_changed_by();