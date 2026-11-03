# Downloaded driving plate library

Design recorded 29 October 2026. This document records the agreed requirements
and recommended implementation; it does not indicate that the feature is built
or deployed.

The local intake and shared media-source prototype is now implemented. See
[first-set preparation, supported parameters and current scope](DRIVING_PLATE_INTAKE.md).
The download gallery, resumable private delivery and R2 adapter are implemented
locally as of 30 October 2026. Manual admin wall binding and per-preset Front/Left/Right/Rear selection are
implemented. Hosted activation, online admin publication and automatic selection
from car rotation remain pending. The user approved retaining the supplied
1280 × 890 format alongside 1280 × 720.

## Confirmed requirements

- Available in both the student editor and main/admin editor.
- Approximately ten locations initially.
- Each location contains four synchronised views of the same drive.
- Each view is at most 300 seconds, 1280 × 720, constant 25 fps, SDR, without audio.
- Admins supply both HEVC and H.264 encodings: eight files per published set.
- Students download a complete four-view encoding before playback; normally only
  one encoding is downloaded, selected after decoder capability checks.
- Target Windows Chrome/Edge and macOS Safari/Chrome on post-2020 devices, using
  supported current browser versions. Device age does not establish HEVC support.
- Select views from the car's rotation relative to its associated LED wall,
  using an admin-authored mapping. Exact frame timing is preferred.
- Admins can upload, publish and remove sets. Uploads accept defined video
  parameters rather than arbitrary sources; automatic transcoding is out of scope.
- Students remain anonymous. Prevent casual hotlinking; student identity, DRM and
  preventing recipients from copying downloaded footage are out of scope.
- The application remains Australia-only. Plate objects need not have a separate
  geographical restriction, but should not be publicly accessible in R2.

## Architecture

Share the catalogue, local download store, frame selection and orientation
resolver between both editors through application-layer services. Keep renderer
integration narrow; preserve each editor's LED UV, brightness, composition,
paused-frame and resource disposal behavior.

Use a private R2 bucket for video objects, D1 for publication metadata, OPFS for
downloaded video bytes and IndexedDB for device-local manifests and download
progress. OPFS and IndexedDB share the origin's storage quota.

Use immutable plate-set revisions. Each manifest identifies all eight objects,
their byte lengths, integrity digests, encoding properties, frame count and
timestamp convention. Each encoding must represent the same source frames in
the same order. Timing validation cannot prove that an admin assigned the correct
footage: include a synchronised four-view preview before publication.

Keep the set's recorded view directions separate from scene bindings. A scene
binding identifies the car, wall, calibrated heading offset and angle sectors.
Persist stable set/revision/node references and playback frame; never persist
object URLs, temporary download URLs or filesystem handles in portable content.
Save the authored mapping with a version so later edits do not change old shots.

## Student and admin browsing

Show location thumbnail, name, duration, selected-encoding download size and
availability: Not downloaded, Downloading, Ready on this device, or Needs repair.
Allow cancel/resume and removal of device-local downloads. Download on selection;
do not prefetch the entire library. Both editors reuse the same local files when
opened on the same origin and browser profile.

At 2 Mbps per view, four five-minute views total approximately 300 MB. Ten sets
at that bitrate total approximately 3 GB for one encoding, excluding overhead.
These are size calculations, not a chosen bitrate or a visual quality result.

Probe the actual decoder path used for presentation/export, rather than relying
only on HTML video support. Prefer HEVC when usable and fall back to H.264 for
the complete set. If an encoding fails actual decoding, offer the alternative
download rather than mixing encodings silently or relying on the network during
playback.

## Local downloads and retention

1. Fetch an immutable manifest and test decoder capability.
2. Estimate quota and reserve headroom for projects, narration, temporary files
   and exports. Quota estimates do not guarantee available physical disk space.
3. Download with bounded concurrency into OPFS using incremental writes.
4. Resume from durable, verified checkpoints with Range requests and immutable
   object identity. Validate 206/Content-Range/length; never append a full 200
   response to a partial file. Recover cleanly from expired download sessions.
5. Verify file integrity with bounded-memory incremental hashing or manifest
   chunk hashes. Avoid whole-file arrayBuffer/digest allocations.
6. Publish a Ready record in IndexedDB only after all four local files are
   closed and verified. Reconcile IndexedDB and OPFS after interruption; they
   do not share one atomic transaction. Coordinate multiple tabs per download.
7. Reopen stored files for playback and release decoder/object URL resources
   before deletion or replacement. Keep compressed files on disk and only a
   bounded window of decoded frames in memory.

Request persistent origin storage during an appropriate user save/download
action, check whether granted, and handle quota errors even after estimation.
There is no guaranteed retention duration. Normal restarts should retain files;
cleared site data, private mode, browser eviction or institutional profile cleanup
can remove them. Changing application origin, browser or profile creates a
separate library. Installing a web app is optional and does not guarantee retention.

The UI must detect missing local files and offer repair. Local video availability
does not by itself make the whole application available after an offline reload.

## Frame timing and car orientation

Use one integer source-frame clock for a plate binding. At 25 fps, frame n starts
at n/25 seconds. All views and both encodings must share frame counts and a
normalised start timestamp of zero. Maximum length is 7,500 frames.

Use the existing Mediabunny/WebCodecs decoded-frame path as the starting point,
shared with the main editor through a narrow media abstraction. Select the angle
and request its frame from the same timeline evaluation. Do not use four
independent HTMLVideoElement clocks or repeatedly replace a playing video src.
Use sequential decode/read-ahead for playback rather than independent random
seeks for every frame. Prototype a bounded prepared-frame window across views;
measure decoder concurrency alongside the renderer before fixing its size.

Paused frames, scrubbing and export wait for the requested frame. Preview may
drop presentation frames or slow under load, but must not deliberately substitute
a different source time at a view change. Matching frame selection does not
guarantee uninterrupted 25 fps on every target machine.

Compute relative horizontal heading from the car and wall's world transforms,
including parent transforms, car-forward convention and calibrated wall reference.
Resolve it through authored angular sectors with explicit wraparound and boundary
rules. Use the same deterministic rule for preview, scrubbing and export. If
hysteresis is later added, define its seek/export behavior explicitly.

Allow an admin to bind a car to a wall, set the zero heading, assign views and
preview the result while rotating the car. Wall rotation and paused car rotation
must also refresh the selected view. Multiple walls have independent bindings;
bindings can share the same downloaded files.

## Admin upload and validation

Recommended first-release contract, beyond the confirmed requirements:

| Property | Proposed publication rule |
| --- | --- |
| Container | MP4; one video track, no audio or other media tracks |
| Dimensions | 1280 × 720, square pixels, no rotation metadata |
| Timing | Constant 25 fps; normalised zero start; matching frame timestamps/counts across all files |
| Duration | Positive, at most 300 seconds / 7,500 frames |
| Colour | SDR BT.709, 8-bit 4:2:0; reject HDR |
| HEVC | Main profile, hvc1 sample entry, suitable level for 720p25 |
| H.264 | High profile, avc1 sample entry, suitable level for 720p25 |
| Seeking | Initial keyframe and at most one-second random-access intervals |
| MP4 layout | Fast-start metadata before media payload |

Bitrate targets and hard byte limits remain an engineering setting to establish
with representative footage and measured quality. A duration/resolution limit
alone does not bound storage. Supply a documented encoding recipe once tested.

Check locally for prompt feedback, then verify actual uploaded bytes and tracks
before publication; client-submitted metadata is not authoritative. Stage uploads
under a private draft prefix and publish atomically only when all eight files,
timing checks, integrity checks, thumbnail and angle metadata are complete.
Report specific failures such as incorrect frame rate or mismatched frame count.

Use resumable multipart or bounded chunk uploads authorised by the admin session;
do not buffer large videos in a Worker or send them through the current small
asset upload endpoint. Interrupted uploads must remain unpublished and removable.

Recommend Remove from library as the normal removal operation: hide from new
selection while retaining immutable revisions for existing projects. Provide a
distinct permanent deletion operation with its effect on existing projects made
clear. Deleted remote bytes cannot recall already downloaded offline copies.

## Access model

Keep public bucket access disabled. Authorise catalogue/download requests through
the application using a short-lived anonymous application session and per-object
download grants; apply rate/concurrency limits. Admin publication/deletion uses
the existing authenticated admin session and same-origin write controls.

Prefer same-origin streamed download routes backed by R2 for the initial release.
They can reuse the app's existing Australia gate rather than introduce a public
delivery bypass. Range/resume requests must receive the same session checks.
Alternatively, short-lived presigned R2 URLs are bearer grants and can be shared
until they expire; they do not need to impose a separate geography rule.

CORS, Referer checks and URLs hidden in JavaScript are not authentication.
An anonymous session deters casual hotlinking but does not prove enrolment or
prevent a determined person from opening the app and obtaining downloads. This
matches the user's accepted scope. Credentials remain server-side.

## Existing integration points and constraints

- `app/src/services/LEDVideoManager.js`: main editor File/object URL lifecycle;
  currently accepts H.264 sample entries only.
- `app/src/previs/media/DecodedLEDSource.js`: existing frame-at-time decoder and
  bounded prepared-frame cache.
- `app/src/previs/media/StudentLEDWallService.js`: deterministic student LED
  composition with staging before presentation.
- `app/src/previs/domain/StudentProjectSchema.js`: existing student timeline is
  25 fps; extend versioned content for plate bindings without rewriting old shots.
- `app/src/services/presets/CloudStudentPresetRepository.js`: cloud media fetches
  do not currently persist a downloaded media library.
- `app/src/previs/api/StudentCatalogueClient.js`: whole-file allocation/hashing
  and a 128 MiB non-model asset limit need a separate large-media path.
- `backend/src/catalogue/CatalogueApi.js`: existing R2 Range/If-Range response
  logic is reusable; current upload buffers bytes and is unsuitable for large video.
- `backend/wrangler.jsonc`: local/test asset uploads currently cap at 64 MiB.
- `functions/_middleware.js` and `backend/src/security/PagesSecurity.js`: preserve
  existing application-wide country gate and admin protections.

This review inspected local source, not live bucket settings or hosted protection.
Existing security/deployment documentation records hosted activation as pending;
verify actual deployment state separately before release.

## Implementation and verification sequence

1. Prove one representative eight-file set: validation, actual HEVC/H.264 decoding,
   a five-minute OPFS download, reopening and bounded-memory playback.
2. Prove deterministic angle/frame selection on the same shared source in both
   editors, paused views and exports before adding the complete gallery.
3. Add private resumable transfers, device library reconciliation and quota UI.
4. Add staged admin uploads, calibration, atomic publication and removal.
5. Test current Windows Chrome/Edge and macOS Safari/Chrome, including a device
   that must use H.264. Measure decoder/render contention, rapid rotations,
   seeking, loop boundaries, interruption/restart, multiple tabs, missing files,
   quota exhaustion, expired sessions and retired/deleted revisions.
6. Verify access checks, bounded memory and failure cleanup, then prepare a hosted
   pilot under the existing deployment rules. Implementation is not authorization
   to deploy or change live storage settings.

## References

- [OPFS overview](https://web.dev/articles/origin-private-file-system)
- [Browser storage and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Mediabunny codecs and capability caveats](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [Mediabunny decoded samples](https://mediabunny.dev/guide/media-sinks)
- [R2 ranged reads and streams](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 presigned bearer grants](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
