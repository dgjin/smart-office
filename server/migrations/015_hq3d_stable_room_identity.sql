ALTER TABLE hq3d_room
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN retired_at DATETIME(3) NULL,
  ADD INDEX idx_hq3d_room_active (is_active, building_id, floor_no);
