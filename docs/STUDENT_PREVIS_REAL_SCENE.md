# Real studio scene rendering proof

Status: 22 October 2026. The separate `/student/scene/` engineering route loads
the actual bundled studio, SUV, rigged mannequin and main LED wall through the
[verified scene loader](STUDENT_PREVIS_SCENE_LOADER.md). It uses the existing
`RealtimeRenderer` post stack, `CameraManager`, `RenderSettings`, canonical
`LightManager`, concrete `ThreeShotPorts`, pose/environment/media services and
the shared `SequenceRasterAdapter`. It creates no admin store or singleton.
The route is an engineering fixture, separate from the student workspace and
published teacher presets. Its hosted static path is protected like the other
admin engineering routes.

## Concrete scene contract

The fixture contains 97 real meshes. Its first shot has closed SUV doors,
standing mannequin, a frozen LED source frame 25 at 1.00 seconds and 4:3 guides.
At sequence frame 125 the complete second shot changes the camera, opens both
front doors using their authored hinge transforms, moves and seats the mannequin,
changes the key-light intensity, changes LED placement and plays media from
source frame 12 at 0.48 seconds. That shot uses 2.40:1 guides. Full output remains
1920×1080 with 50% black source-over bars; no image crop is applied.

The main LED model uses its authored second UV set, explicit UV bounds and
mirroring. Its native stage orientation is rotated to face the fixture cameras.
The LED material uses the same node-material emissive path as the admin raster
preview. The generated 25 fps source has a visible frame counter and distinct
colors; source decoding completes before texture update and raster capture.
The file is a deterministic test source, not published library content.

Actual mannequin vertex positions are sampled into a bounded geometry signature
for standing → sitting → standing checks. That signature supplements complete
portable shot comparison; a pose label alone is insufficient. Door quaternions,
camera/lens/target, canonical lights, appearance, environment and LED presentation
also round-trip through the real scene ports. Restoring refreshes the visible
editing canvas and its guides. Preview transport and portable content remain
separate.

## Reproducible browser proof

```sh
npm run test:previs:scene
npm run test:previs:scene:soak
```

The harness starts the normal app Vite configuration with an independent cache,
HMR disabled and `app/` as the working directory. It launches a disposable real
Chrome profile and requires hardware WebGPU plus cross-origin isolation.
`PREVIS_ARTIFACT_DIR` sets the output directory; `CHROME_PATH` selects the browser.
`PREVIS_BASE_URL` optionally uses an already-running server for exploration.

Checks include:

- Full A → B → A captures at frames 0, 124, 125, 126, 249 and 0; exact shot
  restoration and actual standing/sitting vertex-buffer differences.
- Frozen/advancing source times, decoded-source/composite pixels, attached
  emissive materials, authored UV channel/mirroring and visible colored LED
  pixels in the GPU-rendered scene.
- Exact raw GPU versus composited Canvas2D guide samples, with one code-value
  tolerance for integer alpha rounding; nonuniform scene captures and rendered
  screenshots of both shots for visual inspection.
- Superseded A/B/A seeks; rapid user seeks sharing one preparation; Stop during
  held preparation or decoded-media work; no late shot paint after restoration.
- H.264/AAC MP4 inspection: every expected presentation timestamp exactly once,
  1920×1080, 25 fps, duration, independently decoded samples and one audio click
  per second within one video frame.
- Video encoder queue at most four frames, one pending software AAC command and
  PCM blocks at most 4096 bytes; file transfer to host in 64 KiB chunks.
- Cancel, injected render failure, temporary-file cleanup failure, unchanged
  render-method identity, restored controls/content, successful retry, DPR 2
  physical dimensions and no leftover temporary OPFS entries.

The standard run exports 250 actual scene frames. `--soak` first exports the same
250-frame scene, then all 22,500 frames through the real geometry, GPU post stack
and decoded LED service. It retains bounded metadata, streams the MP4 and follows
the long run with a five-frame real-scene retry. Export audio is still diagnostic
clicks; it does not exercise microphone recording or production narration mixing.

The harness writes `report.json`, `frame-checks.json`, two rendered screenshots
and the streamed MP4 files. Encoder/AAC warmup precedes retained-heap sampling.
Sampled JS heap and forced-GC retained heap are not total browser/native/GPU/WASM
memory measurements. Any observed retained growth must remain visible in the
report rather than being described as bounded total memory.

Initial Chrome hardware-GPU runs verified the scene, complete A/B/A restoration,
actual deformed vertices, preview races, failure cleanup and 250-frame export in
approximately five seconds. Visual inspection confirmed both door states, both
human poses and the visible green/yellow timecode LED on the real wall. Those
exploratory runs also exposed about 35 MB of retained JS growth per full export,
even after a full 250-frame warmup, submitted-GPU-work drain, console clearing
and forced GC. That growth led to two measured fixes: `RealtimeRenderer.syncLights()` now
retains proxy, shadow, shadow-camera and target identities for unchanged canonical
lights; `StudentPosePort` preserves its owned position/normal BufferAttributes
when copying the exact samples produced by the existing mannequin helper.
Removed or changed-type lights still dispose their resources. The shared admin
pose helper and authored material/light values remain unchanged.

The completed short rerun at
`/tmp/student-previs-real-scene-memory-fixed-20261022/report.json` passes all
functional and memory checks. The warmed 250-frame export took 4.78 seconds and
wrote 3,953,720 bytes. After submitted work drained and forced test GC, retained
JS was 68,984,908 bytes before export, 72,546,992 after (+3,562,084), and
81,775,020 after cancellation/failure/cleanup-failure/retry checks. Native
renderer counters remained exactly stable at all four measurements: 266
attributes, 98 geometries, 62 programs, 89 textures, 505 uniform buffers and
22 render targets. Reported tracked renderer allocation total was 529,298,262
bytes. These are renderer counters, not total process/native/GPU residency.
The actual-scene long run also passed. Evidence:
`/tmp/student-previs-real-scene-20261022/report.json`, the two MP4 files and
`real-scene-15min.ffmpeg.json`. Chrome 155.0.8059.85 on the confirmed base
Apple M5 (Mac17,2, 10 CPU cores, 16 GiB RAM) rendered exactly **22,500 frames /
900 seconds** in **450.06 seconds**, streaming **605,057,501 bytes**. Native video
queue maximum was four frames; software AAC had at most one pending command and
4,096-byte PCM blocks. Fifteen decoded framing-pixel comparisons passed.

Independent FFmpeg verifies all 22,500 presentation timestamps exactly, H.264
High at 1920×1080/25 fps, AAC-LC mono at 48 kHz, all 900 click onsets at 21.354 ms
delay and 32 ms tail padding. There is no accumulating audio drift. The harness
also passes cancel, injected render/cleanup failures, restored content/controls,
a subsequent five-frame export, DPR 2 sizing and empty temporary-file inventory.

After GPU submission drain and forced test GC, retained JS was 72,340,328 bytes
before the long export and 76,130,296 after (+3,789,968). After the complete
failure/retry series it was 84,323,932 bytes. Sampled JS heap peak during encoding
was 167,797,303 bytes. All four renderer-counter samples remain exactly the same
as the short run: 266 attributes, 98 geometries, 62 programs, 89 textures, 505
uniform buffers and 22 render targets; tracked allocation total 529,298,262
bytes. Neither metric is total browser/native/GPU/WASM process memory.

The long run renders one full state cut at frame 125 and continuous decoded LED
playback thereafter; separate A/B/A and rapid-seek tests exercise repeated cuts.
Diagnostic audio remains generated clicks. Real microphone narration mixing,
real teacher library delivery, independent GUI players and remaining OS/browser
acceptance are not implied by this local proof.

Saved files can also be checked independently:

```sh
python3 tests/browser/previs/verifyRasterMedia.py /path/to/real-scene-10sec.mp4 --frames 250 --ffmpeg /path/to/ffmpeg
python3 tests/browser/previs/verifyRasterMedia.py /path/to/real-scene-15min.mp4 --frames 22500 --ffmpeg /path/to/ffmpeg
```

## Scope of the evidence

The GPU fixture demonstrates real geometry, authored door hinges, actual baked
mannequin deformation, visible decoded video, complete shot application and
restoration through the existing raster renderer. It does not prove arbitrary
imported scene support, teacher publication, trusted catalogue delivery, offline
video preparation, microphone narration, public sharing or production project
export UI. HDRI loading remains a separately prepared capability; this fixture
uses an explicit no-HDRI appearance. Browser and independent-player acceptance
outside the tested machine remain separate release checks.
