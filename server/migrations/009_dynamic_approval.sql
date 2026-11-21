ALTER TABLE bookings
  ADD COLUMN workflow_version INT UNSIGNED NULL AFTER rule_version,
  ADD COLUMN approval_rule_set_version INT UNSIGNED NULL AFTER workflow_version,
  ADD COLUMN approval_rule_id VARCHAR(128) NULL AFTER approval_rule_set_version,
  ADD COLUMN approval_submitted_at DATETIME(3) NULL AFTER approval_rule_id;
