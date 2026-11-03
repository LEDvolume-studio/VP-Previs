-- Versioned addition: existing draft/revision rows survive unchanged.
CREATE TABLE media_objects (
  draft_id TEXT NOT NULL REFERENCES drafts(draft_id),
  media_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (draft_id, media_id),
  UNIQUE (draft_id, request_id)
);
CREATE TABLE revision_media (
  draft_id TEXT NOT NULL,
  server_revision INTEGER NOT NULL,
  media_id TEXT NOT NULL,
  PRIMARY KEY (draft_id, server_revision, media_id),
  FOREIGN KEY (draft_id, server_revision) REFERENCES draft_revisions(draft_id, server_revision),
  FOREIGN KEY (draft_id, media_id) REFERENCES media_objects(draft_id, media_id)
);
CREATE TRIGGER media_reference_preflight BEFORE INSERT ON revision_media BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM media_objects WHERE draft_id = NEW.draft_id
      AND media_id = NEW.media_id AND state = 'complete'
  ) THEN RAISE(ABORT, 'media incomplete') END;
END;
CREATE TABLE creation_budgets (
  minute INTEGER PRIMARY KEY,
  creations INTEGER NOT NULL
);
CREATE TABLE object_cleanup_attempts (
  object_key TEXT PRIMARY KEY REFERENCES object_reservations(object_key),
  last_swept_at INTEGER NOT NULL
);
