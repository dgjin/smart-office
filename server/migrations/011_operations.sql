INSERT INTO office_state (state_key, payload)
VALUES ('devices', JSON_ARRAY()), ('exceptionActions', JSON_ARRAY())
ON DUPLICATE KEY UPDATE payload = payload;
