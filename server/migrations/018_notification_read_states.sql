CREATE TABLE IF NOT EXISTS notification_read_states (
  notification_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  read_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (notification_id, user_id),
  INDEX idx_notification_read_user (user_id, notification_id),
  CONSTRAINT fk_notification_read_state_notification
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
) ENGINE=InnoDB;
