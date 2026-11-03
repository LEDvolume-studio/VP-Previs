-- Additive local/test supported-scene definitions. Metadata-only v1 stays valid.
ALTER TABLE catalogue_operations ADD COLUMN scene_definition_json TEXT;
ALTER TABLE catalogue_operations ADD COLUMN scene_definition_sha256 TEXT;
CREATE TABLE library_supported_scenes (
 scene_id TEXT NOT NULL, version TEXT NOT NULL, definition_json TEXT NOT NULL,
 sha256 TEXT NOT NULL, PRIMARY KEY(scene_id,version)
);
DROP TRIGGER catalogue_commit;
CREATE TRIGGER catalogue_commit AFTER INSERT ON catalogue_operations BEGIN
 INSERT OR IGNORE INTO library_base_scenes(scene_id,version,scene_json)
 SELECT NEW.scene_id,NEW.scene_version,NEW.scene_json WHERE NEW.action='publish';
 SELECT CASE WHEN NEW.action='publish' AND NOT EXISTS (
 SELECT 1 FROM library_base_scenes WHERE scene_id=NEW.scene_id AND version=NEW.scene_version AND scene_json=NEW.scene_json
 ) THEN RAISE(ABORT,'base scene identity conflict') END;
 INSERT OR IGNORE INTO library_supported_scenes(scene_id,version,definition_json,sha256)
 SELECT NEW.scene_id,NEW.scene_version,NEW.scene_definition_json,NEW.scene_definition_sha256
 WHERE NEW.action='publish' AND NEW.scene_definition_json IS NOT NULL;
 SELECT CASE WHEN NEW.action='publish' AND NEW.scene_definition_json IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM library_supported_scenes WHERE scene_id=NEW.scene_id AND version=NEW.scene_version
 AND definition_json=NEW.scene_definition_json AND sha256=NEW.scene_definition_sha256
 ) THEN RAISE(ABORT,'supported scene identity conflict') END;
 INSERT INTO catalogue_presets(preset_id,version,document_json,sha256,summary_json)
 SELECT NEW.preset_id,NEW.version,NEW.document_json,NEW.sha256,NEW.summary_json WHERE NEW.action='publish';
 INSERT INTO catalogue_heads(preset_id,version,available,revision)
 VALUES(NEW.preset_id,NEW.version,NEW.available,NEW.result_revision)
 ON CONFLICT(preset_id) DO UPDATE SET version=excluded.version,available=excluded.available,revision=excluded.revision;
END;
CREATE TRIGGER supported_scenes_no_update BEFORE UPDATE ON library_supported_scenes BEGIN SELECT RAISE(ABORT,'immutable supported scene'); END;
CREATE TRIGGER supported_scenes_no_delete BEFORE DELETE ON library_supported_scenes BEGIN SELECT RAISE(ABORT,'immutable supported scene'); END;
