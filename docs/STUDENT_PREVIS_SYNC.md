# Private draft backup service foundation

Implemented and verified locally on 22 October 2026. This adds the HTTP and durable
backup services for Phase 5, with real Worker/D1/R2/IndexedDB integration evidence.
The student frontend deliberately remains disconnected: it still truthfully says
that cloud backup is not connected. No hosted service or public sharing exists.

## Contract and ownership

`DraftApiClient` accepts an explicitly configured HTTPS base URL, or HTTP on
loopback for development. It sends ownership only in the Authorization header,
uses no cookies, follows no redirects, requests no caching, and sends no referrer.
Errors expose only static codes/status/retry information: no capability, URL,
server text, document, or raw exception cause. Successful write responses must
acknowledge the exact portable document revision; server revision zero is valid.

The device generates a UUID v4 and 256-bit capability. The repository commits
both, the immutable local revision and stable request identity **before** the
first network operation. The server stores only the capability hash. A lost
creation response can therefore replay the same operation without an orphaned
identity or a recoverable server-side plaintext editing secret.

`PrivateDraftBackupService` is independent of the frontend and admin stores:

```js
const client = new DraftApiClient({ baseURL: configuredOrigin });
const backup = new PrivateDraftBackupService({ repository, client, onStatus });
void backup.start(); // Startup work must not delay the local editing UI.

await repository.save(nextDocument, { expectedRevision });
// The local save is already committed. Background work is separate.
void backup.notifyLocalCommit(nextDocument.projectId);
```

A host must connect those lifecycle hooks before automatic backup becomes an
application feature. No VITE secret, backend hostname or silent cloud activation
was added to the current student page. Backend local setup is documented in
[STUDENT_PREVIS_BACKEND.md](STUDENT_PREVIS_BACKEND.md).

## Durable state and failure behaviour

The existing private `sync` store now holds draft identity, server revision,
frozen in-flight request, retry metadata and conflict state. No database version
bump or new store was needed; portable content remains unchanged.

- Untouched/imported revision zero creates no cloud draft. A meaningful committed
  successor becomes eligible. Newer offline edits can coalesce before freezing.
- `prepareBackup` commits the identity and exact immutable revision/request before
  sending. Restart and retries reuse that flight, even if local edits advanced.
- `acknowledgeBackup` advances the server precondition, acknowledges the exact
  local revision and deletes that exact outbox item in one native transaction.
  If it aborts after remote commit, the same request is replayed. An ack for N
  cannot mark N+1 backed up.
- Each project has one in-process drain. Cross-tab callers share the durable
  flight; server idempotency and local acknowledgement preconditions protect
  duplicate sends. There is no collaborative merge or automatic multi-device
  last-writer-wins.
- On a conditional conflict, the latest local document is preserved as a durable
  recovery copy and the source stops sending. Restoring that copy creates a new
  project and does not inherit editing credentials.
- Bounded exponential equal-jitter retry uses injectable clocks/scheduling.
  Retry state survives restart. Startup, online hints and explicit retry may
  start a new bounded cycle. Online events do not imply server reachability.
- `stop()` cancels timers and requests; pending durable work remains. This is not
  a promise that uploads continue after the browser closes. Work resumes when
  the service next starts.
- Storage failures are distinct from network failures. Observers receive only
  project ID, state and static error code. No secret or document is emitted.

Only reference-free documents are eligible in this slice. Pinned base scenes
remain unverified even when the portable record claims an empty asset list;
model/video/environment references and narration also remain pending. There is no simulated uploader or false
whole-project backup acknowledgement. The server separately refuses to verify
unknown teacher-library claims. Upload checkpoints, recorder integration,
private recovery files/links, authentication revocation UI, global concurrency
budgets and immutable revision/outbox retention still need implementation.
Older superseded outbox items remain stored; cleanup must preserve recovery and
unacknowledged content rather than silently deleting it.

## Verification

Install the separate backend dependencies first (`npm --prefix backend ci`).
From the repository root:

```sh
npm run test:previs
npm run test:previs:storage
npm run test:previs:backend
npm run test:previs:sync
```

The sync browser harness uses real Chromium IndexedDB and the actual Worker in
Miniflare with real emulated D1/R2. A same-origin local HTTP proxy introduces
faults **after actual remote commits**. It does not substitute a Map repository
or fake API. On Chrome 155/macOS it passed seven groups:

1. Revision zero sends nothing.
2. Lost creation response, restart and newer local work replay the frozen create
   exactly, then update with server precondition zero.
3. N+1 edited during a held N upload remains unacknowledged until its own commit.
4. Aborting the native acknowledgement transaction rolls back private server
   revision, local ack and outbox deletion together; replay adds no remote copy.
5. A lost update response survives restart with its original If-Match and key.
6. A genuine second writer causes a preserved independent recovery copy; source
   work survives and portable JSON excludes capability and cloud identity.
7. Unverified pinned base-scene claims remain pending and send no premature
   whole-project backup request.

Pure client/orchestration tests deliberately use fetch/repository fakes for
scheduling, backoff, timeouts, cancellation, malformed acknowledgements and error
redaction. They are not used as transaction or media evidence. Actual microphone
uploads, target-platform runs, hosted outage/recovery drills and a clean-browser
private recovery flow remain pending.
