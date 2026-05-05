
DECLARE
    expiry_time TIMESTAMP;
    base_time TIMESTAMP;
BEGIN
    -- ensure created_at exists
    base_time := COALESCE(NEW.created_at, CURRENT_TIMESTAMP);

    expiry_time := base_time + (NEW.expiry * INTERVAL '1 second');

    IF expiry_time <= NOW() THEN
        NEW.status := 'expired';
    ELSE
        NEW.status := 'active';
    END IF;

    NEW.created_at := base_time;
    NEW.updated_at := CURRENT_TIMESTAMP;

    RETURN NEW;
END;
