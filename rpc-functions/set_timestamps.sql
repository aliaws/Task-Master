
BEGIN
    -- ensure created_at exists
    NEW.created_at := COALESCE(NEW.created_at, CURRENT_TIMESTAMP);

    -- always update updated_at
    NEW.updated_at := CURRENT_TIMESTAMP;

    RETURN NEW;
END;
