# Student account and project contract

Status: implementation contract for steps 1–11 of `USER_PROJECT_SYSTEM_PLAN.md`.
These endpoints are specified, not evidence that they are implemented or deployed.
The existing `/v1/drafts` capability API remains separate; its semantics do not
confer account ownership. The portable student document remains the validated
`StudentProjectSchema` and contains no credentials, cloud pointers or retry state.

## Common HTTP rules

- User IDs, project IDs, login credentials and default version IDs are canonical
  UUID v4 strings. Media and catalogue identifiers follow their existing schema;
  operation IDs follow the idempotency-key syntax below. Times are Unix
  milliseconds in JSON.
  Document and metadata revisions are non-negative safe integers. All JSON request
  and response examples are illustrative; `document` represents a complete valid
  student document, not the abbreviated placeholder as a valid document.
- Student requests use `Authorization: Bearer <login-uuid>` and no admin cookies.
  Admin requests use the existing admin session, country gate and same-origin
  mutation checks; a student credential cannot authorize any admin operation.
  No route accepts a caller-supplied owner as authority. Admin user paths select an
  owner only after admin authorization. Private responses use `Cache-Control:
  no-store`; clients use `credentials: omit` for student requests and never put a
  credential in a query, exported JSON, log, telemetry or error. Limit JSON,
  binary bodies and page sizes on the server.
- List responses are `{ "items": [...], "nextCursor": null | "opaque" }`.
  `limit` defaults to 25 and is capped at 100; an opaque cursor preserves a stable
  `(updatedAt, id)` ordering and is scoped to the authenticated listing. Lists do
  not promise a snapshot under concurrent updates; IDs are deduplicated by clients.
- A mutating operation requires `Idempotency-Key` matching
  `[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}`. Project operation keys are unique per authorized user across project
  operations; other keys are unique within their operation domain. The stable
  request hash includes the route, target, body and preconditions.
  Except for secret issuance as described below, same key and same hash replays the recorded result; same key with different
  content or preconditions returns `409 IDEMPOTENCY_CONFLICT`. Replay never
  bypasses current authorization/revocation. Request identity and frozen bytes
  survive restarts and timeouts. Never retry a changed request under the same key.
- Document updates use `If-Match: "<serverRevision>"`; metadata mutations use
  `If-Match: "<metadataRevision>"`. The version domain is determined by the
  endpoint, not the document's own revision. Missing or malformed preconditions
  return `428 PRECONDITION_REQUIRED`; stale heads return `409 REVISION_CONFLICT`
  or `409 METADATA_CONFLICT`. Bootstrap/default pointer preconditions are stated
  below. Compare and commit must be one D1 atomic operation, not a read followed
  by an unconditional write. A replay check precedes stale-precondition handling.
- Errors have `{ "error": { "code": "...", "message": "..." } }` with
  static, non-secret messages. `400` covers malformed input, `401 UNAUTHORIZED`
  missing/invalid/rotated access, `403 ACCESS_REVOKED` a recognized inactive
  account where safe, `404 NOT_FOUND` inaccessible or absent resources, `409`
  conflicts/incomplete dependencies, `415` unsupported content, `422` invalid
  document, `429` rate limit, and `5xx` unavailable services. Unknown, malformed
  and guessed credentials disclose no identity. Clients treat network errors,
  429 and 5xx as retryable and preserve local content; denial stops uploads.
  Authentication errors never include the link, hash or raw request.

## Identity and administration

A user has a stable public internal `userId`, first name, last name, graduation
year, active state, access generation and timestamps. Names must be non-empty
after trimming; graduation year is a four-digit integer between 1900 and 9999. A separate random UUID v4 login token
is stored server-side only as a SHA-256 hash. Rotation increments the access
generation and replaces the hash atomically; revoke increments the generation
and sets inactive; restore reactivates without changing ownership or bootstrap
state and requires a newly issued link. Reads authorize each request. Every final
D1 write, including a document head, metadata operation and media completion,
checks user active and the authenticated generation in the same atomic commit.
A request authorized before a revoke/rotation cannot commit after that change.
R2 bytes uploaded before denial are unpublished reservations, eligible for bounded
cleanup, never a committed project head or completed media.

| Method and path | Request and result |
| --- | --- |
| `GET /v1/admin/users?limit=&cursor=&q=` | Paginated users with `userId`, `firstName`, `lastName`, `graduationYear`, `active` and `lastCloudActivityAt`; no token/hash. |
| `POST /v1/admin/users` | `{firstName,lastName,graduationYear}` → `201 {user}`. Creates no anonymous student session. |
| `GET /v1/admin/users/:userId` | `{user}`; inaccessible/missing → 404. |
| `PATCH /v1/admin/users/:userId` | `{firstName?,lastName?,graduationYear?,active?}` → `{user}`; `active:false` revokes and `active:true` restores under the generation rules above. |
| `GET /v1/student/me` | Bearer UUID → `{user:{userId,firstName,lastName,graduationYear},accessGeneration}`. No credential echoed. |
| `POST /v1/admin/users/:userId/access-link` | Empty JSON → `{loginUrl,accessGeneration}` once under admin authorization. Each new issuance rotates the token. Copy the returned URL for manual delivery. Replays follow the issuance exception below. |

A login URL is `/student/#login=<uuid>` at the configured public origin. Capture
its fragment before app boot and validate online via `/v1/student/me`. Only after
successful validation atomically persist the credential, user ID and generation
in a private device identity registry and remove the fragment with history
replacement. On invalid/never-validated offline input, do not create an identity.
A previously validated stored identity permits local work while offline. When a
server denies it, abort uploads, retain unsynced work and offer download; an
inactive or offline device cannot learn revocation until reconnection. Account
switch aborts requests and rendering, invalidates a monotonically increasing
session epoch, and discards all late callbacks whose epoch no longer matches.

## Projects and revisions

A summary contains `{projectId,ownerId,name,createdAt,updatedAt,serverRevision,
metadataRevision,archived}`. The `ownerId` in a result is informational. Project
IDs are client-generated UUID v4 and permanently owned by their creating account;
a collision cannot reassign them. Project documents may contain a name, but the
summary metadata is authoritative for project selection and is changed only by
the conditional metadata operation. Export contains the portable document and
its exported media only.

| Method and path | Request and result |
| --- | --- |
| `POST /v1/student/bootstrap` | Empty JSON; idempotently reserve a single project ID and pinned default version per user. After verified bytes and dependencies are live, atomically initialize and return `{project:summary,document,defaultVersionId}`. Concurrent calls or a lost response return the same identity. Pending reservations are retried, never exposed as initialized. Existing users return their existing starter. |
| `GET /v1/student/projects?archived=false&limit=&cursor=` | Owned summaries, including archived when requested. |
| `POST /v1/student/projects` | `{projectId,document}`; document's ID must match. New independent project is registered as server revision 0 even if its document revision is 0. Returns `201` acknowledgement and summary. The first document and verified dependencies become live atomically. |
| `GET /v1/student/projects/:projectId` | `{project:summary,document}` at one consistent cloud head. |
| `PUT /v1/student/projects/:projectId` | `{document}` plus document `If-Match`; exact acknowledgement `{projectId,serverRevision,documentRevision,dependenciesVerified:true}` only after all dependencies are verified and the immutable revision is live. Archived projects reject document writes with `409 PROJECT_ARCHIVED`. |
| `PATCH /v1/student/projects/:projectId/metadata` | `{name?,archived?}` plus metadata `If-Match` → `{project:summary}`. Explicit restore requires `archived:false`; uploads and replay never implicitly restore. |
| `POST /v1/student/projects/:projectId/duplicate` | `{projectId,sourceServerRevision}` with a new ID; copies exactly the selected accessible immutable source and its verified references as an independent revision-zero project. Offline duplicates may instead use project create with a locally materialized valid document and fresh ID. |
| `GET /v1/student/projects/:projectId/revisions/:serverRevision` | `{projectId,serverRevision,document}` for an owned revision. |
| `GET /v1/admin/users/:userId/projects` | Paginated summaries, including archived, under admin authority. |
| `GET /v1/admin/projects/:projectId` and `/revisions/:serverRevision` | Same read shape under admin authority without a student credential. Review is read-only at the service boundary. |

First creation uses server revision 0; each successful conditional update appends
one server revision. `document.revision` is the portable local document counter,
not an authority to overwrite a server head. Document IDs remain stable across
cloud hydration; an adoption transaction installs the downloaded document,
cloud head and matching acknowledged baseline without fabricating a save/outbox
entry or resetting its document revision. If local work is dirty or the remote
response is older than a newer accepted head, do not overwrite it: preserve a
recovery copy and expose reopen-cloud/save-local-as-copy. Acknowledgement must
match the frozen request ID, document revision, server revision and verified
dependencies; an acknowledgement for N cannot clear N+1. Expected-revision
checks and local project, immutable revision and outbox writes remain one native
IndexedDB transaction.

An archived project remains readable and admin-visible. Rename/archive/restore
advance metadata revision independently of document revision. Metadata and
project creation operations are durable outbox entries. An offline edit racing
archive is retained as recovery and cannot restore the project; a deliberate
restore with the current metadata revision is required. Duplicate and import
allocate fresh project IDs and never mutate the source.

## Narration and catalogue dependencies

`POST /v1/student/projects/:projectId/narration` reserves `{mediaId,sha256,
byteLength,mimeType}` and returns `{mediaId,state,uploadPath,completePath}`.
`PUT .../narration/:mediaId/content` uploads/checkpoints bytes and
`POST .../narration/:mediaId/complete` verifies full length, MIME and SHA-256 in
R2 before an active-generation guarded completion. Repeated requests use stable
operation IDs and identical hashes; mismatches conflict. `GET` on the content
path reads owned completed bytes. The corresponding admin `GET
/v1/admin/projects/:projectId/narration/:mediaId/content` uses admin authority.
A document referencing narration may commit only after all referenced media are
complete and match the document inventory. Pinned catalogue scene definitions and
assets must likewise resolve with matching hash, byte length and MIME; no
`dependenciesVerified:true` or offline-ready status may be inferred from a
successful document write alone. Preserve referenced old catalogue versions and
all pending, in-flight and sole recovery media. Bounded orphan cleanup must
fence reservations before deleting and cannot delete live referenced objects.

## Versioned defaults

`GET /v1/admin/student-default` returns current pointer `{versionId,revision}`
and version information; `GET /v1/admin/student-default/versions/:versionId`
returns immutable document and dependency inventory for preview. `POST
/v1/admin/student-default/versions` accepts `{versionId,document,sourceProjectId?}`,
derives its inventory from the validated document, stages immutable bytes and
verifies every dependency. Admins can first upload exact narration bytes with
`PUT /v1/admin/student-default/media/:sha256` using the asset's exact MIME type;
alternatively `sourceProjectId` copies completed narration from a cloud project.
A supported
admin-scene conversion must produce the same valid student document shape; it
must not pretend a reverse conversion exists. `PUT /v1/admin/student-default`
with `{versionId}` and `If-Match: "<pointerRevision>"` atomically advances the
pointer only to a fully verified immutable version (use `If-Match: "-1"` for an
initial pointer); stale pointer updates return
409. An interrupted publication cannot change the old pointer. Bootstrap pins a
version with its reservation and never changes an existing student's copy.
`GET /v1/student/starting-project` stays a compatibility reader during migration.
Publication must first compare the live browser source with the preserved cloud
revision 111 and export it; no older backup is silently promoted.

## Local identity, offline and synchronization

Private registry stores only validated identity and credential, isolated from the
public shell cache. Use stable internal user ID in versioned IndexedDB names for
projects, revisions, recovery, outbox, sync, selection and narration. Shared
immutable public catalogue bytes may be deduplicated by content hash. Existing
unassigned pre-account databases remain untouched until an explicit import into
a selected account creates a fresh project ID and copies its referenced audio.
Changing identity cancels the old lifecycle before opening the new namespace;
callbacks carry and check the captured session epoch before any storage or UI
mutation. Never store Bearer credentials in exported documents or service-worker
caches. Private API responses are network-only.

Local transaction commit is the save boundary. Each local save creates an exact
outbox item and emits one commit notification; bounded workers process all
projects after startup, focus, network recovery, explicit retry and periodic
probes after bounded backoff. Closure pauses, reopening resumes frozen requests.
A validated device may start from its cached identity, document, catalogue and
media offline, creating new projects from the cached pinned default. A first
visit without validated identity requires connection. `Ready offline` requires
all project-specific scene, model, environment, video and narration inventory to
be durably cached and hash-verified, and is revoked on eviction or quota failure.
Shell updates must leave the previous complete shell available and never force a
reload during unsynced editing.

| Event | State / required display |
| --- | --- |
| Edit before transaction commits | `Saving on this device…` |
| Transaction abort/quota | `Not saved on this device — Retry / Download`; retain prior committed data |
| Commit while offline | `Saved on this device · Offline` |
| Commit queued online | `Saved on this device · Waiting to sync` |
| Frozen request in flight | `Syncing…` |
| Exact latest revision and dependencies acknowledged | `Saved to cloud` and last successful sync time |
| Retry exhausted/server unavailable | `Saved on this device · Cloud unavailable — Retry` |
| Stale head/archive conflict | `Changes preserved · Review conflict` |
| Revoked/rotated credential denied | `Access revoked · Local changes retained for download`; stop queue |

Readiness is a separate indicator. A loading or playback message must not replace
save state, and local-only states must not display a cloud-acknowledged icon.

## Manual link issuance

The application does not send invitations or integrate with an email provider.
An authorized admin creates an account with first name, last name and graduation
year, then issues and copies a personal link to deliver manually. No delivery
or receipt status is inferred or displayed. The admin must treat the link as a
credential; anyone holding it can access the account. A new issuance immediately
rotates the previous link, while preserving the same user and project ownership.

The link is returned only in the successful issuance response, over the protected
admin session, with `Cache-Control: no-store`. Store only its SHA-256 hash and an
issuance operation record containing request ID, request hash and generation;
never persist its plaintext in D1, logs, exports or status responses. An exact
idempotency-key replay returns `409 LINK_ALREADY_ISSUED` without rotating or
returning a credential, because the server cannot reconstruct it. If the response
was lost or the admin needs another copy, the admin explicitly starts a new
issuance with a new key; that action rotates and invalidates the earlier link.
A different request under an existing key returns `409 IDEMPOTENCY_CONFLICT`.
The UI must explain the rotation before issuing a replacement.

## Example exchanges

The IDs, timestamps and link below are illustrative only. JSON `document`
placeholders stand for a complete schema-valid object with the matching ID.

```http
GET /v1/student/me HTTP/1.1
Authorization: Bearer 8f0b4565-8b52-482e-81a0-7adfd7b83711
Accept: application/json

HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json

{"user":{"userId":"66c45b30-4185-4096-89a9-13f0235e2157","firstName":"Alex","lastName":"Student","graduationYear":2030},"accessGeneration":1}
```

```http
PUT /v1/student/projects/bedd49f5-4a29-4f9a-9701-c45e7e8ee19d HTTP/1.1
Authorization: Bearer 8f0b4565-8b52-482e-81a0-7adfd7b83711
Idempotency-Key: bedd49f5-4a29-4f9a-9701-c45e7e8ee19d:7
If-Match: "2"
Content-Type: application/json

{"document":"<complete valid student document at local revision 7>"}

HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json

{"projectId":"bedd49f5-4a29-4f9a-9701-c45e7e8ee19d","serverRevision":3,"documentRevision":7,"dependenciesVerified":true}
```

An exact replay returns the same acknowledgement. A different document with
that key returns `409 IDEMPOTENCY_CONFLICT`; a new key with stale `If-Match`
returns `409 REVISION_CONFLICT`. An inaccessible project returns the same 404
shape as a missing project. A metadata rename is independent:

```http
PATCH /v1/student/projects/bedd49f5-4a29-4f9a-9701-c45e7e8ee19d/metadata HTTP/1.1
Authorization: Bearer 8f0b4565-8b52-482e-81a0-7adfd7b83711
Idempotency-Key: rename-bedd49f5-1
If-Match: "0"
Content-Type: application/json

{"name":"Rehearsal"}

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"project":{"projectId":"bedd49f5-4a29-4f9a-9701-c45e7e8ee19d","ownerId":"66c45b30-4185-4096-89a9-13f0235e2157","name":"Rehearsal","createdAt":1793577600000,"updatedAt":1793577601000,"serverRevision":3,"metadataRevision":1,"archived":false}}
```
