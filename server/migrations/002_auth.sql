CREATE TABLE IF NOT EXISTS user_identities (
  issuer VARCHAR(512) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3),
  PRIMARY KEY (issuer, subject),
  UNIQUE INDEX uq_identity_user_issuer (issuer, user_id),
  INDEX idx_identity_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS oidc_auth_requests (
  id VARCHAR(64) PRIMARY KEY,
  state_hash CHAR(64) NOT NULL,
  nonce_hash CHAR(64) NOT NULL,
  code_verifier_encrypted TEXT NOT NULL,
  return_to VARCHAR(512) NOT NULL DEFAULT '/',
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX uq_oidc_state (state_hash),
  INDEX idx_oidc_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  idle_expires_at DATETIME(3) NOT NULL,
  absolute_expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3),
  UNIQUE INDEX uq_session_token (token_hash),
  INDEX idx_session_user (user_id),
  INDEX idx_session_expiry (idle_expires_at, absolute_expires_at)
) ENGINE=InnoDB;
