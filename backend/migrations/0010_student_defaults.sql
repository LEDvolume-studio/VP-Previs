-- Immutable default narration bytes are identified by content and held separately
-- from student-owned media. They may be copied into each starter project.
CREATE TABLE student_default_media_objects (
 sha256 TEXT NOT NULL PRIMARY KEY CHECK(length(sha256)=64),
 object_key TEXT NOT NULL UNIQUE,
 byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
 mime_type TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER student_default_media_no_update BEFORE UPDATE ON student_default_media_objects BEGIN SELECT RAISE(ABORT,'immutable default media'); END;
CREATE TRIGGER student_default_media_no_delete BEFORE DELETE ON student_default_media_objects BEGIN SELECT RAISE(ABORT,'immutable default media'); END;
CREATE TABLE student_default_stage_operations (
 request_id TEXT NOT NULL PRIMARY KEY,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 version_id TEXT NOT NULL REFERENCES student_default_versions(version_id),
 created_at INTEGER NOT NULL
);
-- A version insertion promotes its reserved object atomically and fences cleanup.
CREATE TRIGGER student_default_version_preflight BEFORE INSERT ON student_default_versions BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM object_reservations WHERE object_key=NEW.object_key AND state='pending') THEN RAISE(ABORT,'object unavailable') END;
END;
CREATE TRIGGER student_default_version_commit AFTER INSERT ON student_default_versions BEGIN
 UPDATE object_reservations SET state='live' WHERE object_key=NEW.object_key;
END;
-- A single operation log insert advances the pointer under an atomic CAS.
CREATE TRIGGER student_default_operation_preflight BEFORE INSERT ON student_default_operations BEGIN
 SELECT CASE WHEN NEW.result_revision != NEW.expected_revision+1 OR COALESCE((SELECT revision FROM student_default_head WHERE singleton=1),-1) != NEW.expected_revision THEN RAISE(ABORT,'default conflict') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM student_default_versions v JOIN object_reservations o ON o.object_key=v.object_key WHERE v.version_id=NEW.version_id AND o.state='live') THEN RAISE(ABORT,'default unavailable') END;
END;
CREATE TRIGGER student_default_operation_commit AFTER INSERT ON student_default_operations BEGIN
 INSERT INTO student_default_head(singleton,version_id,revision,updated_at) VALUES(1,NEW.version_id,NEW.result_revision,NEW.created_at)
 ON CONFLICT(singleton) DO UPDATE SET version_id=excluded.version_id,revision=excluded.revision,updated_at=excluded.updated_at;
END;
CREATE TRIGGER student_default_operations_no_update BEFORE UPDATE ON student_default_operations BEGIN SELECT RAISE(ABORT,'immutable default operation'); END;
CREATE TRIGGER student_default_operations_no_delete BEFORE DELETE ON student_default_operations BEGIN SELECT RAISE(ABORT,'immutable default operation'); END;
