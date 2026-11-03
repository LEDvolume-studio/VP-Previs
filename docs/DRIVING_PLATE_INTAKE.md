# Driving plate library and first-set intake

Updated locally on 30 October 2026. No hosted settings, R2 objects, production
deployment or existing project schemas were changed. The supplied Advanced_3mbps
set is prepared in ignored local storage, not bundled into the application.

## Open the pilot

Run the normal admin Vite development server and open `/admin/driving-plates/`.
The main editor's LED tab links to it. The student editor's **Driving plates**
button opens the shared gallery. Students can download, preview and remove
their local copies; the file-import form remains admin-only.

Enter a location name, select the eight files together, then choose **Validate
and save local set**. Open the saved set to check automatic codec selection,
individual frames and relative-heading angle changes. Refresh or reopen the
browser on the same origin/profile to reuse the imported files.

The private download route, resumable transfers and R2 adapter are implemented.
The admin Presets tab now binds a downloaded set to an LED wall and selects its
Front, Left, Right or Rear view. Hosted activation, online admin publication and
automatic selection from car rotation remain separate release work. The library
heading slider remains a standalone media preview.

## Prepare the first real set

Place the following eight files in a local folder. The implementation can inspect
them without first uploading them to R2. A local folder path is sufficient for
the development agent to begin testing the footage.

```text
front-hevc.mp4     front-h264.mp4
right-hevc.mp4     right-h264.mp4
rear-hevc.mp4      rear-h264.mp4
left-hevc.mp4      left-h264.mp4
```

Names are case-insensitive; an underscore may replace the hyphen. These view
labels are initial assignments for calibration, not a restriction on the physical
camera setup. All files must represent matching source-frame ranges.

| Parameter | Intake rule |
| --- | --- |
| Container | Non-fragmented, fast-start MP4; one video track, no audio/other media tracks |
| Resolution | 1280 × 720 or the approved 1280 × 890 format; square pixels, no rotation/flip metadata |
| Timing | Constant 25 fps starting at zero; 1–7,500 frames; identical frame counts across all eight files |
| HEVC | `hvc1` sample entry, Main profile, 8-bit 4:2:0 |
| H.264 | `avc1` sample entry, Baseline/Main/High profile, 8-bit 4:2:0 |
| Colour | SDR with explicit BT.709 primaries, transfer and matrix; limited/video range |
| Seeking | Initial keyframe and random-access intervals no longer than one second |
| File size | At most 512 MiB per file; a technical bound rather than a target bitrate |

Validation reads actual MP4 structures, codec configuration and every encoded
presentation timestamp/duration. It does not infer format from filenames or
average frame rate. It cannot prove that the four views depict the same drive:
the visual check remains necessary. Source clip timing tolerates up to 50 μs of
container rounding, not an additional frame.

## Storage and frame ownership

The pilot uses its own `rayzee-driving-plates-v1` OPFS directory. A completed
`manifest.json` commits each UUID-named set after all eight files close. No partial
set appears as Ready. The pilot deliberately keeps this small metadata marker
beside the files; the future online catalogue/index may use D1 and IndexedDB.

Imports copy/hash 4 MiB chunks sequentially. Playback verifies saved chunk hashes
before opening the selected four files. Admin imports store both encodings. Network downloads normally store only the
four views in one supported encoding; users may explicitly add the alternative.
Browser quota is estimated with working headroom, and actual write failures
abort and remove incomplete copies. **Discard interrupted imports** removes
copies left without a completion marker after a tab/browser crash.

Web Locks coordinate import/cleanup and prevent removal of a set while another
preview holds it open. Closing a preview disposes the four decoders and releases
its lease. Persistent storage can be requested explicitly; retention is still
subject to clearing site data and managed-device policies.

The shared `PlateSetSource` uses an integer 25 fps frame clock and the existing
Mediabunny decoder. It opens all four views transactionally, falls back as a group
from HEVC to H.264, serialises frame requests, stages pixels before presentation
and prevents an obsolete view request from painting over a newer request.
Preview advances by wall-clock time and can skip presentation frames under load;
each presented frame must still have the requested source timestamp. This is
not a guarantee of uninterrupted 25 fps on all target devices.

## Verification

From the repository root, run the targeted tests:

```sh
node node_modules/vitest/vitest.mjs run tests/unit/previs/drivingPlates.test.js tests/unit/previs/localPlateLibrary.test.js tests/unit/previs/plateSetSource.test.js tests/unit/previs/decodedLEDSource.test.js
```

Generate disposable two-second synthetic 720p25 fixtures with a local FFmpeg
binary that includes libx264/libx265:

```sh
PLATE_TEST_FFMPEG=/absolute/path/to/ffmpeg node scripts/generate-plate-fixtures.mjs
```

With Vite running on port 5176, run the Chrome browser proof:

```sh
node tests/browser/previs/drivingPlates.browser.mjs
```

`PLATE_TEST_ORIGIN` and `PLATE_FIXTURE_DIR` can override those defaults. The harness
uses an isolated browser profile and writes screenshots/report to ignored
`.local-runtime/plate-validation/`. Generated videos are also ignored and are
never bundled into the app.

The initial proof tested real HEVC and H.264 decoding, all four views at the same
frame, distinct pixels per view, local storage across reload/tabs, explicit H.264
playback to the endpoint, deletion leases and same-length corruption detection.
The supplied three-minute footage is now verified through real resumable HEVC
and H.264 downloads and exact offline final-frame decoding. Sustained renderer
performance and Windows Edge/macOS Safari still require device testing.


## Gallery and transfer behavior

- Each card uses a frame from the front clip and a separate eight-second,
  480-pixel-wide H.264 hover preview. Hovering never fetches a full driving video.
  Keyboard focus supports preview; reduced-motion preferences suppress autoplay.
- Download bars show received bytes, percentage and MiB. A set becomes Downloaded
  only after all four final files have been read back and verified.
- Four-MiB chunk files are durable checkpoints. Each is checked against manifest
  SHA-256 before saving and checked again on resume. Completed intact camera files
  are reused after interruptions; partial files never appear as downloaded.
- Requests require exact 206/Content-Range responses, use an idle timeout and retry
  transient failures up to three times. Expired anonymous sessions renew without
  restarting a transfer. Offline transfers wait for the browser to come online.
- Pause/Resume survives reloads. Partial downloads may be discarded. A damaged
  completed file changes the card to Repair download; intact views are reused.
- Downloaded thumbnails and hover previews are cached in OPFS, so local browsing
  and playback work without video network access. This does not make the entire
  application shell available after an offline page reload.
- Cross-tab leases protect playing/downloading sets from concurrent deletion.
  Normal storage quota, persistence and managed-profile retention limits apply.

## Supplied first set and preparation

`../Video_files/Advanced_3mbps` contains eight matching 4,500-frame clips: three
minutes at 25 fps, 1280 × 890, SDR BT.709, with one-second random-access intervals.
The user explicitly approved retaining this resolution on 30 October 2026.
HEVC is approximately 257.0 MiB for four views; H.264 approximately 257.8 MiB.

The preparation tool validates every file and hashes it incrementally, makes
independent staging copies, and extracts the front thumbnail and preview without
changing any source footage:

```sh
PLATE_TEST_FFMPEG=/absolute/path/to/ffmpeg node scripts/prepare-plate-set.mjs ../Video_files/Advanced_3mbps
```

The generated `.local-runtime/plate-catalogue/` is ignored by Git and excluded
from app bundles. It contains `catalogue.json` and immutable, content-derived set
folders containing eight videos, `manifest.json`, `thumbnail.jpg` and `preview.mp4`.
The Vite plugin serves it through the same private route as the R2 adapter.

## Hosted delivery contract

The Worker routes are GET `/v1/plates`, POST `/v1/plates/session` and GET/HEAD
`/v1/plates/<immutable-id>/<asset>`. The app's trusted Australia gate still runs
before these routes. Students remain anonymous; the short-lived HttpOnly,
SameSite=Strict session cookie prevents casual hotlinking, not deliberate copying
by a recipient or proof of enrolment. CORS is not used as authentication.

A future authorised deployment needs `ENABLE_PLATE_API=true`, a private `LIBRARY`
R2 binding and a server-only `PLATE_SESSION_SECRET` containing 32 random bytes
encoded as 64 hex characters. The prepared catalogue belongs under the `plates/`
prefix in that bucket. Public bucket access should remain disabled. No R2 objects,
secrets or hosted settings were created by this local implementation.

Full video responses are not cached by the browser HTTP cache; small browsing
assets use private caching and are capped at 2 MiB by the server. Video ranges
stream from R2 without buffering complete files in a Worker. Manifest-derived
chunk hashes protect the download against changed or incomplete responses.

## Download verification

With the local catalogue prepared and Vite running on port 5176:

```sh
node tests/browser/previs/plateDownloads.browser.mjs
PLATE_FORCE_H264=true node tests/browser/previs/plateDownloads.browser.mjs
node --test tests/integration/previs/backend.plates.mjs
```

The browser proof uses the supplied real set in an isolated profile. It checks
hover traffic, forced connection failure/retry, Pause/Resume across reload,
verified-chunk reuse, four-file storage, cached browsing media, exact final-frame
decoding with networking disabled and repair of same-length corruption. Forcing
H.264 simulates a failed HEVC capability probe; it is not a substitute for testing
on a real Windows/Edge or Safari device.

Reports and screenshots are saved under ignored `.local-runtime/plate-download-validation/`
and `.local-runtime/plate-download-validation-h264/`.


## Admin preset angles

In the student editor, playback follows the absolute timeline at 25 fps: timeline
frame 125 displays plate frame 125 (5 seconds), even if that frame begins a new
shot using another angle. Scrubbing and pausing use the same frame calculation.
The admin's paused calibration frame does not freeze student timeline playback.

In **Admin editor → Presets → Driving plate**:

1. Choose a downloaded plate set. If the scene has multiple LED walls, select
   which wall should receive it. The chosen set starts playing on that wall.
2. Select **Front**, **Left**, **Right** or **Rear**. The wall changes to that
   camera at the same source frame and keeps its current play/pause state.
3. Use **Update preset** or **Save new preset** to store the angle with the
   camera/object preset. Applying it restores the angle from whichever set is
   currently selected; it does not switch the project back to an older set.
4. **Play plate / Pause plate** is available here. Existing LED-tab seek, loop,
   placement and brightness controls continue to work.

The same decoded set and LED geometry/material instances survive angle changes.
A canvas media adapter feeds exact decoded frames into the existing LED manager,
including its paused-frame/path-tracer lifecycle. The selected view's actual
video file is used for preset capture, so the saved thumbnail and student media
snapshot represent the chosen camera angle.

Projects retain immutable local set/view references and restore them from browser
storage on reopening. A missing set is shown as needing download rather than
requesting a local file handle. No blob URLs or decoder resources are stored in
project JSON. Legacy presets default to Front.

Validation: `tests/browser/previs/adminPlateAngles.browser.mjs` exercises the
real admin editor, supplied footage, four distinct wall images at one exact
frame, save/reapply, switching to another set, and project reopening. Run it
against the development origin used by the other plate browser proofs.

### Editor selection and automatic downloads

Both editors use a compact **Select Driving Plates** modal. The device's
WebCodecs decoder is checked against all four HEVC views; unsupported devices
receive the H.264 set. The UI reports the chosen codec without a manual format
selector. A shared download service keeps progress visible outside the modal,
coalesces scene and picker requests, and preserves resumable chunk checkpoints.

Published file metadata now includes a full-file `sha256` alongside the chunk
hashes. This maps a scene's pinned video to its exact set and camera view before
requesting a download. Playback can then use the corresponding synchronised view
in the device-supported encoding. Unknown standalone videos retain their pinned
catalogue path. Older local manifests can gain the content hashes only when their
original file inventory and chunk hashes match; downloaded video bytes are still
verified before decoding. The existing Advanced R2 manifest has been enriched
with these hashes without changing its set ID or footage.
