-- Local/test only. Immutable library content and an atomic catalogue head log.
CREATE TABLE library_assets (
 asset_id TEXT NOT NULL, version TEXT NOT NULL, metadata_json TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL,
 PRIMARY KEY(asset_id, version)
);
CREATE TABLE library_base_scenes (
 scene_id TEXT NOT NULL, version TEXT NOT NULL, scene_json TEXT NOT NULL,
 PRIMARY KEY(scene_id, version)
);
CREATE TABLE catalogue_presets (
 preset_id TEXT NOT NULL, version TEXT NOT NULL, document_json TEXT NOT NULL,
 sha256 TEXT NOT NULL, summary_json TEXT NOT NULL,
 PRIMARY KEY(preset_id, version)
);
CREATE TABLE catalogue_heads (
 preset_id TEXT PRIMARY KEY, version TEXT NOT NULL, available INTEGER NOT NULL CHECK(available IN (0,1)),
 revision INTEGER NOT NULL,
 FOREIGN KEY(preset_id, version) REFERENCES catalogue_presets(preset_id, version)
);
CREATE TABLE catalogue_operations (
 preset_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('publish','availability')),
 version TEXT NOT NULL, available INTEGER NOT NULL CHECK(available IN (0,1)),
 expected_revision INTEGER NOT NULL, result_revision INTEGER NOT NULL,
 document_json TEXT, sha256 TEXT, summary_json TEXT,
 scene_id TEXT, scene_version TEXT, scene_json TEXT,
 PRIMARY KEY(preset_id, request_id)
);
CREATE TRIGGER catalogue_commit AFTER INSERT ON catalogue_operations BEGIN
 INSERT OR IGNORE INTO library_base_scenes(scene_id,version,scene_json)
 SELECT NEW.scene_id,NEW.scene_version,NEW.scene_json WHERE NEW.action = 'publish';
 SELECT CASE WHEN NEW.action = 'publish' AND NOT EXISTS (
 SELECT 1 FROM library_base_scenes WHERE scene_id=NEW.scene_id AND version=NEW.scene_version AND scene_json=NEW.scene_json
 ) THEN RAISE(ABORT,'base scene identity conflict') END;
 INSERT INTO catalogue_presets(preset_id,version,document_json,sha256,summary_json)
 SELECT NEW.preset_id,NEW.version,NEW.document_json,NEW.sha256,NEW.summary_json WHERE NEW.action='publish';
 INSERT INTO catalogue_heads(preset_id,version,available,revision)
 VALUES(NEW.preset_id,NEW.version,NEW.available,NEW.result_revision)
 ON CONFLICT(preset_id) DO UPDATE SET version=excluded.version,available=excluded.available,revision=excluded.revision;
END;
CREATE TRIGGER library_assets_no_update BEFORE UPDATE ON library_assets BEGIN SELECT RAISE(ABORT,'immutable library asset'); END;
CREATE TRIGGER library_assets_no_delete BEFORE DELETE ON library_assets BEGIN SELECT RAISE(ABORT,'immutable library asset'); END;
CREATE TRIGGER library_scenes_no_update BEFORE UPDATE ON library_base_scenes BEGIN SELECT RAISE(ABORT,'immutable base scene'); END;
CREATE TRIGGER library_scenes_no_delete BEFORE DELETE ON library_base_scenes BEGIN SELECT RAISE(ABORT,'immutable base scene'); END;
CREATE TRIGGER catalogue_versions_no_update BEFORE UPDATE ON catalogue_presets BEGIN SELECT RAISE(ABORT,'immutable preset'); END;
CREATE TRIGGER catalogue_versions_no_delete BEFORE DELETE ON catalogue_presets BEGIN SELECT RAISE(ABORT,'immutable preset'); END;
CREATE TRIGGER catalogue_operations_no_update BEFORE UPDATE ON catalogue_operations BEGIN SELECT RAISE(ABORT,'immutable catalogue operation'); END;
CREATE TRIGGER catalogue_operations_no_delete BEFORE DELETE ON catalogue_operations BEGIN SELECT RAISE(ABORT,'immutable catalogue operation'); END;
