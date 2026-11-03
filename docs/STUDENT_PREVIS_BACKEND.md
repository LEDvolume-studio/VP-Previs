# Student backend local foundation

Status: 22 October 2026. A separate Cloudflare Worker package now exercises
anonymous private document revisions and owner-scoped narration against real
Miniflare D1 and R2 emulation. No Cloudflare credentials were read, no resources
were provisioned, and no deployment was performed. This is a local Phase 4
foundation, not a hosted student pilot or completion of every Phase 4 gate.

## Run locally

Use Node 22; this machine was checked with 22.22.3. From `rayzee-renderer/backend`:

```sh
npm ci
npm test
npm run check
npm run migrate:local
npm run dev
```

Dependencies are pinned in the backend's independent `package-lock.json`:
Wrangler 4.151.3, Miniflare 4.20260730.0, and esbuild 0.28.2. No root/application
dependency changes are needed. The compatibility date is 2026-07-30.
`npm run check` bundles with Wrangler's dry-run option; it does not deploy.
The CLI wrapper only accepts fixed local operations, rejects extra
arguments, and disables Wrangler telemetry. D1 state and buckets remain under
ignored `backend/.wrangler/`. Tests use isolated in-memory workerd instances.

`wrangler.jsonc` declares different local and test D1/bucket names. The default,
preview, and production configurations have the API disabled and no bindings.
The Worker also rejects hosted environment names even if someone changes only
`ENABLE_DRAFT_API`. Neither workers.dev nor preview URLs are enabled. Enabling
hosted operation requires a separate reviewed change after the hosting,
rate limit and storage decisions in the questions document. The user's chosen
shared-password admin protection and Australia-only network gate now have a
[separate local security foundation](STUDENT_PREVIS_ADMIN_SECURITY.md), including
the actual Pages middleware before static files. Hosted authentication remains
disabled by default, and no hosted configuration was changed.

## Ownership and retry contract

The browser must generate and durably save these private values **before its
first create request**:

- A UUID v4 draft ID.
- A capability from 32 cryptographically random bytes, encoded as unpadded
  canonical base64url (43 characters).
- A stable idempotency key and the exact frozen document to send.

This deliberately changes the plan's proposed "return a capability once" flow:
the client generates the capability, allowing a lost creation response to be
retried without retaining recoverable plaintext authority on the server.
The server stores only SHA-256 of the capability. It never returns that secret,
puts it in a URL, or embeds it in the portable student document. Ownership is
sent only in `Authorization: Bearer <capability>`. Anyone possessing it owns the
private draft; it must remain in separate device sync metadata. There is no
recovery exchange yet. Losing device storage and every private recovery copy
currently loses access to the cloud draft.

Every write with an idempotency key accepts
`[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}`. Existing `projectUUID:revision` outbox keys
fit. Keys convey no authority. Retrying an operation requires the same key,
precondition and JSON content. The request hash uses parsed JSON serialization;
clients should preserve the frozen record rather than reconstructing it with a
different property order. Different content with an existing key returns 409.

| Operation | Request | Successful result |
| --- | --- | --- |
| Create | `POST /v1/drafts`, JSON `{draftId, document}`, capability and `Idempotency-Key` | 201 acknowledgement; identical retries return 200 |
| Read | `GET /v1/drafts/:draftId`, capability | 200 acknowledgement plus `document`, quoted `ETag` |
| Update | `PUT /v1/drafts/:draftId`, JSON `{document}`, capability, `Idempotency-Key`, exact `If-Match: "0"` (or next acknowledged revision) | 200 acknowledgement |

An acknowledgement has exactly these fields:

```js
{
  draftId,
  serverRevision,        // starts at 0; each accepted successor increases by 1
  documentRevision,      // exact portable document.revision accepted
  dependenciesVerified, // see below; not synonymous with storing JSON
  replayed              // true when returning an earlier accepted operation
}
```

Portable edit revisions may skip numbers when several offline edits coalesce
into one cloud revision. Updates must keep the original `projectId` and strictly
increase the portable edit revision. Exact idempotent replays remain valid after
later revisions: replaying an update acknowledged at server revision 1 returns
revision 1, even if the current head is 2. A late acknowledgement must never clear
newer local pending work. Reads return one internally consistent accepted
revision; concurrent writes can advance the head while a read is in flight.

The strict shared student schema rejects unknown fields, editing secrets as
extra fields, unsupported schema versions, invalid references and sequences
beyond 22,500 frames. It does not import admin documents. Requests are streamed
through a byte counter before JSON parsing, even without `Content-Length`.
Missing/forged/wrong/revoked capabilities use the same 401 envelope. There is no
cookie authentication for drafts, cross-origin allowance or public object endpoint.

Errors have `{error: {code, message}}`, with static messages that do not echo
request content, capabilities or provider errors. Relevant statuses/codes:

| Status | Codes |
| --- | --- |
| 400 | `INVALID_JSON`, `INVALID_BODY`, `INVALID_ID`, `REQUEST_ID_REQUIRED` |
| 401 | `UNAUTHORIZED` |
| 403 | `AUSTRALIA_ONLY` (network country gate) |
| 409 | `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `MEDIA_NOT_READY`, `CREATE_INCOMPLETE` |
| 413 / 415 / 422 | `PAYLOAD_TOO_LARGE` / `CONTENT_TYPE` / `INVALID_DOCUMENT`, `INVALID_SUCCESSOR`, `INVALID_MEDIA`, `MEDIA_MISMATCH` |
| 428 / 429 | `PRECONDITION_REQUIRED` / `DEVELOPMENT_LIMIT` |
| 500 / 503 | `INTERNAL_ERROR` / `NOT_CONFIGURED`, `STORAGE_UNAVAILABLE` |

On `REVISION_CONFLICT`, retain the local document/outbox and produce a recovery
copy before resolving; there is no automatic last-write-wins behavior. A failed
or interrupted initial create may leave a private reservation at head -1. Retry
the original creation identity/content to finish it; it is not a readable backup.

## Immutable storage and dependencies

Each document upload reserves a unique server-generated R2 key in D1, writes
immutable bytes using conditional R2 put and SHA-256, and verifies the stored
length/checksum before publishing a database pointer. The authoritative SQL
INSERT checks capability, revocation and exact previous server revision. SQLite
triggers atomically advance the head and mark the object live. A D1 transaction
also records references to verified narration. A stale contender cannot create
a sibling accepted successor. Revision rows cannot be updated or deleted.

A local/test trusted teacher asset catalogue was added on 23 October; see [catalogue contract](STUDENT_PREVIS_CATALOGUE_BACKEND.md). Private draft dependency verification is deliberately not connected to it yet. Documents with any `assets` or
`baseScenes` entries receive **`dependenciesVerified: false`**. Their JSON is
stored privately, but that does not establish that their model/library video/HDRI
bytes are recoverable. Missing, wrong-hash or cross-draft narration is rejected.
Only a document without external scene/library dependencies, with every required
narration object verified, can currently receive `dependenciesVerified: true`.
The client must use this field before displaying a whole-project backup claim.

`cleanupAbandonedDocuments(env, {cutoff, maximum})` is an explicit maintenance
utility, with no HTTP endpoint, scheduled trigger or default retention period.
It fences expired pending document reservations as `deleting` inside D1 before
deleting bytes. Such a reservation cannot subsequently become a revision.
Accepted/live revisions are protected. Tombstones persist and are revisited in
rotating bounded batches: an upload already in flight can finish after a delete,
and a later pass removes those unreferenced bytes. No narration, accepted
revision or future shared snapshot is garbage-collected. Do not extend cleanup
to those records without implementing retained snapshot references and policy.

## Owner-scoped narration contract

Create a draft without narration first, then reserve/upload/complete narration
before updating the document to reference it. These endpoints all require the
same draft capability:

1. `POST /v1/drafts/:id/narration`, with `Idempotency-Key` and JSON
   `{mediaId, sha256, byteLength, mimeType}`. `mediaId` is the exact portable
   `assetId@version`; SHA-256 is lowercase hex. Supported development MIME types
   are `audio/webm`, `audio/ogg`, `audio/mp4`, and `audio/wav`.
2. The response contains `{mediaId, state, uploadPath, completePath}`. These are
   relative authenticated Worker paths; no R2 key, public URL or secret is exposed.
3. `PUT uploadPath` sends the complete recording bytes with the reserved
   `Content-Type`. Byte count and SHA-256 must match. Conditional storage prevents
   overwriting immutable bytes. An exact retry is safe.
4. `POST completePath` checks R2 length and SHA-256 before setting `complete`.
   It is idempotent. Later draft writes verify ownership, digest, size, MIME and
   object availability and record exact revision-to-media references.

This bounded whole-recording upload is a first contract, not resumable multipart
or MediaRecorder checkpoint upload. Hash/size/MIME verification establishes byte
integrity, **not** valid audio container, codec, duration, segment hashes or
decodability. These need a later media inspection contract and browser proof.
Completed narration has no public download route in this slice.

## Development limits and release gates

The explicit local defaults are 1 MiB JSON, 16 MiB per whole narration upload,
10,000 cloud revisions per draft, 100 media reservations per draft and 30 new
draft attempts per UTC minute across the local instance. The global D1 creation
counter avoids trusting an IP header and is only a development safeguard;
concurrent attempts for one draft may consume more than one budget slot. Tests
use smaller byte limits. Missing/invalid limit bindings fail closed. These are
configurable **development** limits, not school-approved quotas, retention or a
production abuse-prevention design. There is no automatic expiry or deletion.

Admin routes now use the user's chosen shared-password session, with no user
accounts; forged Access headers or draft bearer tokens grant no admin authority.
Missing password configuration fails closed. Authenticated publishing routes
return 501 until those operations exist. See the [security
contract](STUDENT_PREVIS_ADMIN_SECURITY.md) for exact session/error/configuration
behavior, static-site protection and Australia-only access. Published
catalogue/preset versions, private media reads/recovery, share
publication/view/revocation, draft deletion, resumable narration, hosted limits
and deployment remain unimplemented release gates. The student UI is not
connected by this backend change.

## Verification

Run `npm test` in `backend/`. Fourteen draft integration groups use genuine Miniflare
workerd D1 and R2 bindings; there are no Map substitutes for either store. They
cover hashed ownership and lost-response retry, missing/forged/cross-project and
revoked authority, concurrent creates/retries, exactly one winner for conflicting
updates, old acknowledgement replay, schema/size/precondition/identity errors,
unverified library acknowledgement, teacher fail-closed behavior, owner-scoped
narration and missing/cross-project media, migrations from empty and the preceding
draft-only fixture, corruption/missing R2 bytes, configured budgets, and cleanup
fencing/rotation/races. Migration tests use the pinned Wrangler SQL splitter so
triggers are passed as whole statements. The preceding fixture is the new local
0001 schema, not a claim about any legacy hosted database.

Nine additional security groups verify the shared-password/static/Australia gate,
actual Pages Functions packaging and a real 600,000-iteration hosted-mode
password check inside Miniflare. Their generated fixtures are not a live deploy.

Also verified: Wrangler dry-run bundle, actual local Wrangler application of
0001 and 0002 migrations, and ESLint on Worker source/integration tests. No hosted
Cloudflare, cross-region latency, production auth/abuse, or real audio decode
claims are established by these tests.

Current implementation references: Cloudflare's [D1 transaction batch
API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 conditional
puts and checksums](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
and [Wrangler environment/binding
configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

### Shared starting timeline

The hosted student editor reads `GET /v1/student/starting-project` for new
browser profiles. This route serves the validated student project stored as
`student/shared-starting-project.json` in the private `LIBRARY` R2 bucket. It is
shared with anonymous students behind the existing Australian edge gate; do not
put private working drafts or narration there. Each student imports a new local
copy, so edits do not alter the shared source. Existing browser projects are
preserved, and the project menu can create another copy of the starting timeline.
All pinned scene definitions and assets referenced by the document must already
be published to the catalogue. Private student project backup remains disabled.
