# Shared preset authoring storage

The admin Presets tab can save authoring scenes to D1 and publish their portable
student presets to the existing shared catalogue. Images, GLBs, HDRIs and video
remain immutable, SHA-256-verified R2 library assets. Saving a preset never enables
private student project backup.

## Routes

- `GET /v1/admin/preset-editor?summary=1`: `{presets:[summary,...]}` for the current available editable heads, used by the admin panel.
- `GET /v1/admin/preset-editor`: retained full-record list for compatibility.
- `GET /v1/admin/preset-editor/:presetId`: the latest full editable record.
- `PUT /v1/admin/preset-editor/:presetId`: `{name,adminDocument,studentPreset}`.

All three routes require the existing shared-password admin session. Writes also
require the trusted same-origin request checks, `Idempotency-Key`, and either
`If-None-Match: *` for creation or `If-Match: "revision"` for updates. GET and PUT
responses include the quoted revision ETag. The initial revision is zero. Every
update must use a fresh immutable student preset version, including renames.

The record has the existing app repository shape:
`{format:"rayzee-local-preset",schemaVersion:1,presetId,revision,name,createdAt,updatedAt,adminDocument,studentPreset,thumbnail:null}`.
The format describes the shared app contract; this API persists the record in
D1. `studentPreset.thumbnail` references an immutable R2 image asset. The cloud
client hydrates that reference into a Blob for the admin panel.

The compact list contains only
`{presetId,revision,name,createdAt,updatedAt,thumbnailAsset}`. Its thumbnail field
contains verified image asset metadata or null. D1 extracts those fields without
returning complete authoring documents or student snapshots. Selecting a preset
then fetches its full record individually. This keeps ordinary library listing
small even when six or more complete authoring scenes exceed the aggregate JSON
transport bound.

Upload each asset first through the existing protected
`PUT /v1/admin/catalogue/assets/:assetId/:version` route. The editor PUT verifies
those bytes and supported GLB mappings, then inserts one guarded
`catalogue_operations` row. SQLite triggers commit both the immutable editor
revision and the student publication in that same statement. A failed authoring
insert rolls back the catalogue head, public preset, scene registration and
operation receipt. Retrying an identical operation key returns its original
record without rolling a newer catalogue head back.

Public student routes expose only portable presets, summaries, supported scene
definitions and verified assets. The admin document is excluded. Existing shots
retain their copied snapshots and pinned historical asset and scene versions.

## Deployment preparation

No hosted activation, migration or deployment is performed automatically.
Prepare the intended Pages environment using the existing protected all-route
Functions build described in `../docs/CLOUDFLARE_DEPLOYMENT.md`.

1. Bind `DB` to the shared preset catalogue D1 database and `LIBRARY` to its R2
   bucket. Apply the catalogue migrations, including
   `migrations/0006_preset_editor.sql`, to that database. A new database needs the
   earlier migrations too. Local migration remains `npm run migrate:local`.
2. Supply the existing migrated `ADMIN_AUTH_DB` and server-only password verifier
   and session secret. Hosted auth uses `ENABLE_HOSTED_ADMIN_AUTH=true` and the
   Cloudflare-compatible 100,000 PBKDF2 iterations. Use a long, randomly generated admin password because Workers limits native PBKDF2 iterations.
3. Explicitly set `ENVIRONMENT=preview` or `production`,
   `ENABLE_CATALOGUE_API=true`, and `ENABLE_HOSTED_CATALOGUE_API=true`. Both
   catalogue activation flags and both storage bindings are required. The
   checked-in hosted configurations remain disabled.
4. Configure positive `MAX_JSON_BYTES` and `MAX_LIBRARY_ASSET_BYTES` bounds.
   Use 90 MiB for the hosted asset bound to stay below Cloudflare’s request-size limit. Model uploads remain limited to 64 MiB. Larger videos need a multipart upload implementation.
   Keep `ENABLE_DRAFT_API=false` for preset-only activation. Draft handlers retain
   their independent local/test environment gate.
5. Build the admin and student app with the same-origin catalogue configuration,
   then compile the actual Pages Functions with `npm run check:pages` in
   `backend/`. Deploy only when explicitly authorized.

D1 limits a string, Blob or complete table row to 2,000,000 bytes. The editor
preflight caps the combined serialized operation payload at 1,900,000 bytes to
leave room for keys and SQLite record metadata. The operation contains both the
portable student JSON and the full editable record, so the accepted request can
be smaller than the general JSON transport bound. Oversized scenes receive HTTP
413 before any publication mutation. Typical material metadata of roughly
100 KiB fits; large embedded data should remain in verified R2 assets. See
[Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

The compact list also respects `MAX_JSON_BYTES`; further growth beyond that
bound requires pagination rather than increasing individual D1 row sizes.

## Verification

`npm test` in `backend/` exercises the native Miniflare D1/R2 implementation.
`backend.preset-editor.mjs` covers auth/privacy, concurrent revision guards,
idempotent retries, injected trigger rollback, hosted preset-only activation,
and the actual cloud admin/student clients. The latter uploads a bundled GLB
and thumbnail, saves and renames a cloud preset, reads it anonymously as a
student, rejects a stale save, and resolves historical scene definitions after
the current inventory version changes.
