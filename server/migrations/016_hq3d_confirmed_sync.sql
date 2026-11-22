CREATE TABLE IF NOT EXISTS hq3d_room_resource (
  room_uid VARCHAR(255) NOT NULL,
  resource_id VARCHAR(128) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  decision_ref VARCHAR(16) NOT NULL,
  decision_basis VARCHAR(16) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(128) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (room_uid),
  UNIQUE KEY uq_hq3d_room_resource_id (resource_id),
  CONSTRAINT fk_hq3d_room_resource_room FOREIGN KEY (room_uid) REFERENCES hq3d_room(uid)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS hq3d_room_disposition (
  room_uid VARCHAR(255) NOT NULL,
  disposition VARCHAR(32) NOT NULL,
  review_status VARCHAR(32) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  decision_ref VARCHAR(16) NOT NULL,
  decision_basis VARCHAR(16) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by VARCHAR(128) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (room_uid),
  CONSTRAINT fk_hq3d_room_disposition_room FOREIGN KEY (room_uid) REFERENCES hq3d_room(uid)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS resource_retirements (
  resource_id VARCHAR(128) NOT NULL,
  resource_snapshot JSON NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  decision_ref VARCHAR(16) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  cancelled_booking_ids JSON NOT NULL,
  retired_by VARCHAR(128) NOT NULL,
  retired_at DATETIME(3) NOT NULL,
  PRIMARY KEY (resource_id),
  INDEX idx_resource_retirements_plan (plan_id, retired_at)
) ENGINE=InnoDB;
