-- Stable operation IDs make administrative account changes replay-safe.
CREATE TABLE student_admin_operations (
  request_id TEXT NOT NULL PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  result_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
