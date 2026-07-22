CREATE TABLE IF NOT EXISTS finance_member_locks (
  member_id TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
