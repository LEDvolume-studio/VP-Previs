-- Durable, user-scoped request identities for account project mutations.
CREATE TABLE account_project_requests (
  user_id TEXT NOT NULL REFERENCES student_users(user_id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  project_id TEXT NOT NULL REFERENCES student_projects(project_id),
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
