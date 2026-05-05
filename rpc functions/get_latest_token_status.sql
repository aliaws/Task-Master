
SELECT id, auth_code, refresh_token, access_token,
       CONCAT(
           FLOOR(EXTRACT(EPOCH FROM remaining)/3600), ' hours, ',
           FLOOR((EXTRACT(EPOCH FROM remaining)%3600)/60), ' minutes'
       ) AS time_left_readable,
        CASE
           WHEN (updated_at + expiry * INTERVAL '1 second') <= NOW()
           THEN 'expired'
           ELSE 'active'
       END AS status
FROM (
    SELECT id, auth_code, refresh_token, access_token, updated_at, expiry,
           (updated_at + expiry * INTERVAL '1 second') - NOW() AS remaining
    FROM engage_tokens
    ORDER BY id DESC
    LIMIT 1
) t;
