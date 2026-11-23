SET @notification_read_collation = (
  SELECT COLLATION_NAME
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'id'
);

SET @notification_read_states_ddl = CONCAT(
  'CREATE TABLE IF NOT EXISTS notification_read_states (',
  'notification_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE ', @notification_read_collation, ' NOT NULL,',
  'user_id VARCHAR(128) NOT NULL,',
  'read_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
  'PRIMARY KEY (notification_id, user_id),',
  'INDEX idx_notification_read_user (user_id, notification_id),',
  'CONSTRAINT fk_notification_read_state_notification ',
  'FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE ', @notification_read_collation
);

PREPARE notification_read_states_stmt FROM @notification_read_states_ddl;
EXECUTE notification_read_states_stmt;
DEALLOCATE PREPARE notification_read_states_stmt;
