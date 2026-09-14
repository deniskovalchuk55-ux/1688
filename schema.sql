CREATE TABLE IF NOT EXISTS trends (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  subcategory   TEXT,
  audience      TEXT,
  age_group     TEXT,
  horizon       TEXT NOT NULL DEFAULT 'near',
  status        TEXT NOT NULL DEFAULT 'active',
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trend_signals (
  id            SERIAL PRIMARY KEY,
  trend_id      INTEGER NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  value         NUMERIC NOT NULL,
  prev_value    NUMERIC,
  growth_pct    NUMERIC,
  payload       JSONB
);

CREATE INDEX IF NOT EXISTS idx_signals_trend ON trend_signals(trend_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS trend_scores (
  trend_id      INTEGER PRIMARY KEY REFERENCES trends(id) ON DELETE CASCADE,
  momentum      NUMERIC NOT NULL DEFAULT 0,
  volume        NUMERIC NOT NULL DEFAULT 0,
  confidence    NUMERIC NOT NULL DEFAULT 0,
  score         NUMERIC NOT NULL DEFAULT 0,
  peak_estimate TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trend_media (
  id            SERIAL PRIMARY KEY,
  trend_id      INTEGER NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  url           TEXT NOT NULL,
  thumb_url     TEXT,
  title         TEXT,
  views         BIGINT,
  published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_trend ON trend_media(trend_id);

CREATE TABLE IF NOT EXISTS job_runs (
  id            SERIAL PRIMARY KEY,
  job           TEXT NOT NULL,
  source        TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  ok            BOOLEAN,
  items         INTEGER DEFAULT 0,
  message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_recent ON job_runs(started_at DESC);
