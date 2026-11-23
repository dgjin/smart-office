ALTER TABLE notifications
  ADD INDEX idx_notification_user_time (user_id, timestamp, id);
