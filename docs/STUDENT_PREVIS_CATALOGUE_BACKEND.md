# Local immutable teacher catalogue backend

23 October 2026. This is the local/test Phase 6 storage/API slice. Hosted activation
remains disabled. No teacher publishing screen, production retention/quota policy,
real video codec-duration inspection, or deployment is implied. The supported-scene
extension below now checks actual registered GLB containers and node hierarchies.

## Trust and storage

`backend/src/catalogue/CatalogueApi.js` uses the shared strict
`StudentCatalogueSchema.js` contract. Presets contain complete pinned assets,
base-scene inventory and snapshot content; no arbitrary fetch URLs or editing
credentials are accepted. `X-Asset-Metadata` has the same exact asset record shape
as the student project document. Media durations are registered metadata; matching
bytes do not prove those durations or supported glTF geometry/material contents.
The renderer/publication preflight must still check actual decoding and scene support.

Migration `0004_catalogue.sql` adds immutable asset metadata, immutable base-scene
identities, immutable preset versions, mutable catalogue heads and immutable mutation
receipts. `LIBRARY` is a separate R2 binding. An asset upload reads the request
stream with a byte bound, computes actual SHA-256, compares exact length/MIME metadata,
uses a conditional R2 put and verifies the stored size/provider checksum before D1
registration. Publication verifies every declared asset against server registration
and R2 head checksum/length. JSON claims alone cannot publish a preset.

A D1 trigger commits a publication's immutable preset, base-scene registration,
head pointer and receipt atomically. Concurrent different base-scene inventories
cannot claim one `sceneId@version`. A failed race cannot leave a partial preset.
Published versions are never overwritten or removed by the API. Hiding a head
removes it from browse results; existing pinned versions and their assets remain
resolvable. Registered library assets are readable by their exact immutable identity
in Australian requests; registration is not a private asset-staging service.

Library reads verify R2 checksum/size and serve the returned object stream. Clients
still verify downloaded complete bytes before parsing. There is no automatic object
cleanup or invented retention policy; a failed competing asset registration can leave
unreferenced immutable R2 bytes for a future explicit maintenance workflow.
Private draft `dependenciesVerified` remains conservative and unchanged by this slice.

## HTTP contract

All endpoints first enforce trusted Australian request geography. Admin reads and
writes additionally require the existing shared-password session. Writes enforce
same-origin request checks. All catalogue responses are `Cache-Control: no-store`,
with `nosniff` and `Cross-Origin-Resource-Policy: same-origin`.

| Endpoint | Behavior |
| --- | --- |
| `GET /v1/catalogue` | `{format:'rayzee-student-catalogue',schemaVersion:1,presets:[summary]}` for available heads only. Summary fields are exactly presetId, version, name, description, category, defaultDurationFrames, thumbnail. Strong content ETag; exact If-None-Match supports 304. |
| `GET /v1/catalogue/presets/:id/:version` | Complete immutable preset, including hidden historical versions. Rechecks dependencies. Strong content SHA ETag and exact conditional 304. |
| `GET /v1/catalogue/assets/:id/:version` | Registered immutable bytes. Strong SHA ETag, Accept-Ranges, Content-Length, MIME and inline disposition. Single byte ranges, suffix ranges and open-ended ranges return 206. Invalid/unsatisfiable/multipart ranges return 416 with `Content-Range: bytes */size`. If-Range mismatch returns the whole object. |
| `PUT /v1/admin/catalogue/assets/:id/:version` | Raw bytes, exact Content-Type and JSON `X-Asset-Metadata`. First verified registration returns 201; exact retries return 200. Reusing identity with different metadata returns 409. |
| `GET /v1/admin/catalogue/presets/:id` | Current `{presetId,version,available,headRevision,replayed:false}` and head-revision ETag for a fresh admin client. |
| `PUT /v1/admin/catalogue/presets/:id/:version` | Complete preset JSON. First publication uses `If-None-Match: *`; successors use `If-Match: "N"` with the current **head revision**, plus stable Idempotency-Key. Publication makes the new version available. |
| `POST /v1/admin/catalogue/presets/:id/availability` | JSON `{version,available}` matching current head version, exact `If-Match: "N"` and stable Idempotency-Key. Hides or restores the current head. |

A mutation acknowledgement is
`{presetId,version,available,headRevision,replayed}`. Its ETag is the quoted decimal
head revision, which starts at 0 and increases on every publication or availability
change. This ETag is distinct from the immutable preset GET's SHA ETag. Revisions
avoid stale writes after an available/hidden/available cycle. Missing conditions
return 428; stale conditions or immutable identity conflicts return 409.

Receipts bind the Idempotency-Key to canonical content, action and original
precondition. An exact retry returns the original acknowledgement with
`replayed:true`, even after later publications; it never moves the pointer backward.
Reusing a request key for different content/preconditions returns 409.

## Local configuration and limits

`ENABLE_CATALOGUE_API` is separate from draft activation and must be `true` with
`ENVIRONMENT=local|test`, `DB` and `LIBRARY`. Any hosted environment still returns
503 even if the flag is set. Default, preview and production configurations keep
the flag false and have no library binding. Local/test config binds
`ADMIN_AUTH_DB` to the same development D1 database so migration 0003 supplies the
existing password throttling table; server-only test/local secrets are still required.

Current local technical bounds are `MAX_JSON_BYTES=1048576`,
`MAX_LIBRARY_ASSET_BYTES=67108864` (64 MiB), and a 16 KiB asset metadata header.
Aggregated catalogue JSON exceeding `MAX_JSON_BYTES` fails closed with 503;
pagination is required before catalogue growth reaches that engineering bound.
Upload accumulation/hashing remains bounded in memory, rather than a production
large-object streaming implementation. These are engineering safeguards, not settled
hosted quotas. Existing local CLI migration/build checks remain remote-disabled.

## Verification

`node --test tests/integration/previs/backend.catalogue.mjs` passes eight integration
groups against the bundled actual Worker, migrated real Miniflare D1 and R2:

- local/hosted activation, AU geography, shared-password session and CSRF failures;
- actual upload hash/length, exact metadata, malformed content, declared and streamed
  byte bounds, immutable D1 asset records and missing registration;
- publish/hide/replace, pinned historical reads, receipt replay, stale head rejection,
  wrong version rejection and immutable preset records;
- duplicate concurrent retries and competing publications with one winner;
- concurrent conflicting base-scene registrations with complete transaction rollback;
- complete/range bytes, MIME, 206/416, strong ETags/304, If-Range fallback and corrupt
  or missing R2 storage failures;
- unchanged conservative private draft dependency acknowledgements;
- aggregate catalogue JSON bounds and malformed availability request types.

Scoped ESLint and `npm run check` in `backend/` pass. The latter is a local Worker
dry run, not a deployment. Root browser integration separately exercises student
library browsing against this contract; this API test alone is not a production
publishing or rendering acceptance gate.


## Supported-scene extension — 23 October 2026

Migration `0005_supported_scenes.sql` adds immutable supported-scene definitions.
Schema-version 1 presets remain metadata-only and keep their existing shape;
they do not acquire rendering capability by inference. Schema-version 2 presets
require a complete `sceneDefinition` with exact model identities, glTF index/name
mappings, stable scene-instance/node IDs and explicit human pose capabilities.
Definitions carry no URLs. Model assets must exactly cover the base scene; all
snapshot nodes must match those mappings. Current capabilities require explicit
raster appearance, perspective cameras, explicit display nodes, authoritative
hinge transforms, and no HDRI asset. Unsupported features fail publication.

Before a version-2 publication, the Worker checks every asset against exact D1
registration and R2 checksum/size. It additionally downloads each model from that
server-owned R2 key with a 64 MiB per-model bound, recomputes SHA-256 and length,
and checks the complete GLB container and exact node hierarchy. External image or
buffer URIs, unsupported declared extensions, unmapped nodes, stale expected names,
and declared human roots lacking the required standing/sitting POSITION/NORMAL
morph capabilities fail closed. Definitions have a 128 MiB aggregate model bound.
These remain local technical safeguards, rather than hosted quotas. Video durations
and codec support still require their separate actual decode preflight.

The replacement D1 commit trigger stores the canonical definition and SHA-256,
base-scene inventory, preset, catalogue head and receipt in one transaction.
Different node definitions cannot claim the same `sceneId@version`, even when
the model inventory is identical and competing publishers target different presets.
The losing transaction leaves no partial preset, head or receipt. Definition
records cannot be updated or deleted.

`GET /v1/catalogue/scenes/:sceneId/:version` returns exactly
`{sceneDefinition,assets}`, where assets contain only the pinned model inventory.
It validates the definition digest, identity, registered metadata and actual model
bytes before responding, including before an exact conditional 304. The strong
ETag is the quoted definition SHA-256. Missing definitions return 404, so a legacy
metadata-only preset is never presented as renderable. Existing Australian-request,
admin publishing-session, same-origin-write and hosted-disabled rules apply.
Private draft dependency acknowledgements remain unchanged.

`StudentCatalogueClient.getScene({sceneId,version},{signal})` validates the exact
response shape, requested scene identity, asset inventory and definition capability
contract, then keeps defensive copies in a bounded immutable metadata cache.
Concurrent conflicting definitions fail; `clear()` prevents older in-flight work
repopulating that cache. `getAssetBytes(asset,{signal})` uses only the configured
immutable asset route with credentials omitted and redirects rejected. It verifies
exact MIME, full-response status, declared/streamed length and actual SHA-256 before
returning a fresh `Uint8Array`. Reads are capped at 64 MiB for models and 128 MiB
for other asset kinds, release/cancel their reader on rejection or cancellation,
and do not keep an unbounded raw-byte cache. Caller-supplied source URLs are invalid.

Verification: the new `backend.catalogue-scenes.mjs` integration covers actual
bundled LED GLB publication/resolution, ETags, legacy metadata-only lookup, immutable
records, corrupt R2 reads, conflicting concurrent definitions with atomic rollback,
stale node names, unsupported extensions, external URI and missing LED UV channel
rejection. Together with
the unchanged version-1 catalogue tests, all 14 groups pass against actual bundled
Worker/Miniflare D1/R2. Existing and new catalogue-client tests pass (52 tests).
