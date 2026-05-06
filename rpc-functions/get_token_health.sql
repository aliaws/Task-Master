
SELECT jsonb_build_object(
    'id', id,
    'auth_code', auth_code,
    'refresh_token', refresh_token,
    'access_token', access_token,
    'time_left_readable',
        CONCAT(
            FLOOR(EXTRACT(EPOCH FROM remaining)/3600), ' hours, ',
            FLOOR((EXTRACT(EPOCH FROM remaining)%3600)/60), ' minutes'
        ),
    'status',
        CASE
            WHEN (updated_at + expiry * INTERVAL '1 second') <= NOW()
            THEN 'expired'
            ELSE 'active'
        END
)
FROM (
    SELECT
        id,
        auth_code,
        refresh_token,
        access_token,
        updated_at,
        expiry,
        (updated_at + expiry * INTERVAL '1 second') - NOW() AS remaining
    FROM engage_tokens
    ORDER BY id DESC
    LIMIT 1
) t;
