INSERT INTO office_state (state_key, payload)
VALUES
  ('organizationSyncBatches', JSON_ARRAY()),
  ('externalCallbacks', JSON_ARRAY()),
  ('externalCompensations', JSON_ARRAY()),
  ('accessAuthorizationFacts', JSON_ARRAY())
ON DUPLICATE KEY UPDATE payload = payload;
