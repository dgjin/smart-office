CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id VARCHAR(64) PRIMARY KEY,
  job_key VARCHAR(191) NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  run_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
  lease_owner VARCHAR(64),
  lease_expires_at DATETIME(3),
  last_error TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3),
  UNIQUE INDEX uq_scheduled_job_key (job_key),
  INDEX idx_scheduled_job_claim (status, run_at, lease_expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(64) PRIMARY KEY,
  event_key VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_owner VARCHAR(64),
  lease_expires_at DATETIME(3),
  last_error TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3),
  UNIQUE INDEX uq_outbox_event_key (event_key),
  INDEX idx_outbox_claim (status, available_at, lease_expires_at)
) ENGINE=InnoDB;
