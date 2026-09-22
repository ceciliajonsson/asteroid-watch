CREATE TABLE IF NOT EXISTS asteroids (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  approach_at      TEXT NOT NULL,
  approach_epoch   INTEGER NOT NULL,
  diameter_min_m   REAL,
  diameter_max_m   REAL,
  velocity_kps     REAL,
  miss_ld          REAL,
  miss_km          REAL,
  hazardous        INTEGER NOT NULL DEFAULT 0,
  sentry           INTEGER NOT NULL DEFAULT 0,
  magnitude        REAL,
  jpl_url          TEXT,
  tier             TEXT,
  tier_confidence  REAL,
  wow_score        REAL,
  needs_context    REAL,
  status           TEXT NOT NULL,   -- featured | listed | review
  decided_at       TEXT NOT NULL,
  raw_decision     TEXT
);
CREATE INDEX IF NOT EXISTS idx_asteroids_approach ON asteroids (approach_epoch);
CREATE INDEX IF NOT EXISTS idx_asteroids_status ON asteroids (status);
