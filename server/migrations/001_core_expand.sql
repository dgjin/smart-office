CREATE TABLE IF NOT EXISTS office_state (
  state_key VARCHAR(64) PRIMARY KEY,
  payload JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  resource_id VARCHAR(128) NOT NULL,
  start_time DATETIME(3) NOT NULL,
  end_time DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_booking_conflict (resource_id, status, start_time, end_time),
  INDEX idx_booking_user (user_id, start_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME(3) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  type VARCHAR(16) NOT NULL,
  link_view VARCHAR(32),
  INDEX idx_notification_user (user_id, is_read, timestamp)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS office_snapshot_meta (
  id TINYINT PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO office_snapshot_meta (id, revision) VALUES (1, 1);
