-- Authoring revisions commit in the same SQLite statement as publication.
ALTER TABLE catalogue_operations ADD COLUMN editor_record_json TEXT;
CREATE TABLE preset_editor_revisions (
 preset_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL,
 PRIMARY KEY(preset_id, revision)
);
CREATE TRIGGER preset_editor_commit AFTER INSERT ON catalogue_operations
WHEN NEW.editor_record_json IS NOT NULL BEGIN
 INSERT INTO preset_editor_revisions(preset_id,revision,record_json)
 VALUES(NEW.preset_id,NEW.result_revision,NEW.editor_record_json);
END;
CREATE TRIGGER preset_editor_no_update BEFORE UPDATE ON preset_editor_revisions BEGIN SELECT RAISE(ABORT,'immutable preset editor revision'); END;
CREATE TRIGGER preset_editor_no_delete BEFORE DELETE ON preset_editor_revisions BEGIN SELECT RAISE(ABORT,'immutable preset editor revision'); END;
