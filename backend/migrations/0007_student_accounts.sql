-- Additive account metadata. Existing drafts and catalogue records are left
-- untouched. Credentials are SHA-256 hashes, never bearer UUIDs.
CREATE TABLE student_users (
  user_id TEXT NOT NULL PRIMARY KEY,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) > 0),
  graduation_year INTEGER NOT NULL CHECK (typeof(graduation_year) = 'integer' AND graduation_year BETWEEN 1900 AND 9999),
  access_state TEXT NOT NULL DEFAULT 'active' CHECK (access_state IN ('active', 'revoked')),
  access_generation INTEGER NOT NULL DEFAULT 1 CHECK (access_generation >= 1),
  credential_hash TEXT UNIQUE CHECK (credential_hash IS NULL OR length(credential_hash) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A published version names a verified immutable object and its dependency
-- inventory. Publication advances the singleton pointer separately.
CREATE TABLE student_default_versions (
  version_id TEXT NOT NULL PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE REFERENCES object_reservations(object_key),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  dependencies_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE student_default_head (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version_id TEXT NOT NULL REFERENCES student_default_versions(version_id),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER student_default_versions_no_update BEFORE UPDATE ON student_default_versions BEGIN
  SELECT RAISE(ABORT, 'immutable student default version');
END;
CREATE TRIGGER student_default_versions_no_delete BEFORE DELETE ON student_default_versions BEGIN
  SELECT RAISE(ABORT, 'immutable student default version');
END;

-- draft_id maps to the existing immutable revision and narration machinery.
-- A reservation may precede creation of that draft; only live rows are listed.
CREATE TABLE student_projects (
  project_id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES student_users(user_id),
  draft_id TEXT UNIQUE REFERENCES drafts(draft_id),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'live')),
  title TEXT NOT NULL,
  metadata_revision INTEGER NOT NULL DEFAULT 0 CHECK (metadata_revision >= 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, project_id),
  CHECK (state != 'live' OR draft_id IS NOT NULL)
);
CREATE INDEX student_projects_owner_list ON student_projects(user_id, state, archived, updated_at DESC, project_id);

-- One reservation per user pins the project and default across retries.
CREATE TABLE student_bootstraps (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES student_users(user_id),
  project_id TEXT NOT NULL UNIQUE,
  default_version_id TEXT NOT NULL REFERENCES student_default_versions(version_id),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'complete')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id, project_id) REFERENCES student_projects(user_id, project_id)
);

-- Operation IDs are scoped to their authority; request hashes detect reuse with
-- a different payload. The implementation must commit mutations atomically.
CREATE TABLE student_project_operations (
  user_id TEXT NOT NULL REFERENCES student_users(user_id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'duplicate', 'rename', 'archive', 'restore')),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id),
  FOREIGN KEY (user_id, project_id) REFERENCES student_projects(user_id, project_id)
);
CREATE TABLE student_default_operations (
  request_id TEXT NOT NULL PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  version_id TEXT NOT NULL REFERENCES student_default_versions(version_id),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= -1),
  result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
  created_at INTEGER NOT NULL
);

-- Issuance records provide replay detection without persisting the bearer link.
-- A lost issuance response requires an explicit new request and rotation.
CREATE TABLE student_access_issuance_operations (
  user_id TEXT NOT NULL REFERENCES student_users(user_id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  access_generation INTEGER NOT NULL CHECK (access_generation >= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id)
);

-- Initialization may be reserved before upload, but completion requires a live
-- project with a committed, live revision object. Keep that guarantee on later
-- changes to the project row as well.
CREATE TRIGGER student_bootstrap_complete_insert BEFORE INSERT ON student_bootstraps
WHEN NEW.state = 'complete' BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM student_projects p JOIN drafts d ON d.draft_id = p.draft_id
    JOIN draft_revisions r ON r.draft_id = d.draft_id AND r.server_revision = d.head_revision
    JOIN object_reservations o ON o.object_key = r.object_key AND o.state = 'live'
    WHERE p.user_id = NEW.user_id AND p.project_id = NEW.project_id AND p.state = 'live'
  ) THEN RAISE(ABORT, 'bootstrap project not live') END;
END;
CREATE TRIGGER student_bootstrap_complete_update BEFORE UPDATE ON student_bootstraps
WHEN NEW.state = 'complete' BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM student_projects p JOIN drafts d ON d.draft_id = p.draft_id
    JOIN draft_revisions r ON r.draft_id = d.draft_id AND r.server_revision = d.head_revision
    JOIN object_reservations o ON o.object_key = r.object_key AND o.state = 'live'
    WHERE p.user_id = NEW.user_id AND p.project_id = NEW.project_id AND p.state = 'live'
  ) THEN RAISE(ABORT, 'bootstrap project not live') END;
END;
CREATE TRIGGER student_bootstrap_project_guard BEFORE UPDATE ON student_projects
WHEN EXISTS (SELECT 1 FROM student_bootstraps b WHERE b.project_id = OLD.project_id AND b.state = 'complete')
  AND (NEW.state != 'live' OR NEW.draft_id IS NOT OLD.draft_id OR NEW.user_id != OLD.user_id OR NEW.project_id != OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'completed bootstrap project cannot be reassigned');
END;

CREATE TRIGGER student_bootstrap_reservation_guard BEFORE UPDATE ON student_bootstraps
WHEN NEW.user_id != OLD.user_id OR NEW.project_id != OLD.project_id
  OR NEW.default_version_id != OLD.default_version_id
  OR (OLD.state = 'complete' AND NEW.state != 'complete')
BEGIN
  SELECT RAISE(ABORT, 'bootstrap reservation cannot be reassigned');
END;
