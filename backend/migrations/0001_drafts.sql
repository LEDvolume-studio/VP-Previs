-- Immutable R2 documents are registered before upload. Cleanup must fence a
-- pending reservation in D1 before deleting its bytes; live objects never expire.
CREATE TABLE object_reservations (
  object_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('pending', 'live', 'deleting')),
  created_at INTEGER NOT NULL
);
CREATE TABLE drafts (
  draft_id TEXT PRIMARY KEY,
  capability_hash TEXT NOT NULL CHECK (length(capability_hash) = 64),
  create_request_id TEXT NOT NULL,
  create_request_hash TEXT NOT NULL,
  head_revision INTEGER NOT NULL DEFAULT -1 CHECK (head_revision >= -1),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE draft_revisions (
  draft_id TEXT NOT NULL REFERENCES drafts(draft_id),
  server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
  document_revision INTEGER NOT NULL CHECK (document_revision >= 0),
  project_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE REFERENCES object_reservations(object_key),
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (draft_id, server_revision),
  UNIQUE (draft_id, request_id)
);
-- One SQLite statement serializes compare/append/head/object changes. A failed
-- trigger rolls all of them back. Workers must not implement a JS read-then-set.
CREATE TRIGGER revision_preflight BEFORE INSERT ON draft_revisions BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM drafts WHERE draft_id = NEW.draft_id AND revoked = 0
      AND head_revision = NEW.server_revision - 1
  ) THEN RAISE(ABORT, 'revision conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM object_reservations WHERE object_key = NEW.object_key AND state = 'pending'
  ) THEN RAISE(ABORT, 'object unavailable') END;
END;
CREATE TRIGGER revision_commit AFTER INSERT ON draft_revisions BEGIN
  UPDATE drafts SET head_revision = NEW.server_revision WHERE draft_id = NEW.draft_id;
  UPDATE object_reservations SET state = 'live' WHERE object_key = NEW.object_key;
END;
CREATE TRIGGER revision_no_update BEFORE UPDATE ON draft_revisions BEGIN
  SELECT RAISE(ABORT, 'immutable revision');
END;
CREATE TRIGGER revision_no_delete BEFORE DELETE ON draft_revisions BEGIN
  SELECT RAISE(ABORT, 'immutable revision');
END;
CREATE INDEX pending_objects ON object_reservations(state, created_at);
