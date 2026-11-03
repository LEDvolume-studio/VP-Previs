-- Copy uploads are fenced independently from document reservations because
-- their objects live in NARRATION, not DOCUMENTS. Pending is never swept.
CREATE TABLE narration_copy_reservations (
  object_key TEXT NOT NULL PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('pending', 'live', 'abandoned')),
  created_at INTEGER NOT NULL,
  last_swept_at INTEGER
);
CREATE INDEX narration_copy_cleanup ON narration_copy_reservations(state, last_swept_at, created_at);
-- A request ID remains bound even when a verified copied/default asset exists.
CREATE TABLE account_media_requests (
  draft_id TEXT NOT NULL REFERENCES drafts(draft_id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  PRIMARY KEY (draft_id, request_id)
);
