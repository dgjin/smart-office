ALTER TABLE bookings
  ADD COLUMN rule_version INT UNSIGNED NULL AFTER status;
