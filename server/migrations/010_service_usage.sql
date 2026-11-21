ALTER TABLE bookings
  ADD COLUMN schedule_version INT UNSIGNED NULL AFTER approval_submitted_at,
  ADD COLUMN actual_start_time DATETIME(3) NULL AFTER schedule_version,
  ADD COLUMN actual_end_time DATETIME(3) NULL AFTER actual_start_time,
  ADD COLUMN released_at DATETIME(3) NULL AFTER actual_end_time,
  ADD COLUMN release_reason VARCHAR(500) NULL AFTER released_at,
  ADD COLUMN release_type VARCHAR(40) NULL AFTER release_reason,
  ADD COLUMN access_revoked_at DATETIME(3) NULL AFTER release_type;

CREATE INDEX idx_bookings_schedule_version ON bookings (id, schedule_version);
CREATE INDEX idx_bookings_released_at ON bookings (released_at);
