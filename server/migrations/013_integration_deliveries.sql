INSERT INTO office_state (state_key, payload)
VALUES ('integrationDeliveries', JSON_ARRAY())
ON DUPLICATE KEY UPDATE payload = payload;
