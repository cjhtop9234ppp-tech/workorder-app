CREATE TABLE IF NOT EXISTS master_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
