CREATE TABLE IF NOT EXISTS hq3d_building (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  aspect DECIMAL(9,5) NOT NULL,
  asp_all JSON NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hq3d_floor (
  building_id VARCHAR(32) NOT NULL,
  floor_no SMALLINT UNSIGNED NOT NULL,
  floor_tag VARCHAR(16) NOT NULL,
  sheet_name VARCHAR(128) NOT NULL,
  area_total DECIMAL(10,2) NULL,
  updated_by VARCHAR(128) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (building_id, floor_no),
  INDEX idx_hq3d_floor_building (building_id, floor_tag)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hq3d_room (
  uid VARCHAR(255) PRIMARY KEY,
  building_id VARCHAR(32) NOT NULL,
  floor_no SMALLINT UNSIGNED NOT NULL,
  room_no VARCHAR(64) NOT NULL DEFAULT '',
  category VARCHAR(32) NOT NULL,
  label VARCHAR(255) NOT NULL,
  dept VARCHAR(255) NOT NULL DEFAULT '',
  person VARCHAR(255) NOT NULL DEFAULT '',
  notes VARCHAR(512) NOT NULL DEFAULT '',
  label_lines JSON NOT NULL,
  nx DECIMAL(9,6) NOT NULL,
  nz DECIMAL(9,6) NOT NULL,
  nw DECIMAL(9,6) NOT NULL,
  nd DECIMAL(9,6) NOT NULL,
  frac DECIMAL(9,6) NOT NULL DEFAULT 0,
  sort_index SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_hq3d_room_floor (building_id, floor_no, sort_index),
  INDEX idx_hq3d_room_no (room_no),
  INDEX idx_hq3d_room_category (building_id, category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hq3d_room_profile (
  room_uid VARCHAR(255) PRIMARY KEY,
  label VARCHAR(255) NULL,
  person VARCHAR(255) NULL,
  dept VARCHAR(255) NULL,
  notes VARCHAR(512) NULL,
  category VARCHAR(32) NULL,
  area_sqm DECIMAL(10,2) NULL,
  history JSON NOT NULL,
  updated_by VARCHAR(128) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_hq3d_profile_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hq3d_room_maintenance (
  id VARCHAR(64) PRIMARY KEY,
  room_uid VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  note TEXT NOT NULL,
  reporter VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_hq3d_mnt_room (room_uid, status, created_at),
  INDEX idx_hq3d_mnt_status (status, created_at)
) ENGINE=InnoDB;
