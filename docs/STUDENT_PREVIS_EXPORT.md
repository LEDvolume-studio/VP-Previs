# Raster MP4 feasibility evidence

Verified locally on 22 October 2026: macOS 26.6.1 arm64, Chrome 155.0.8059.85, WebGPU backend. The admin smoke identifies Apple Metal 3 with a hardware adapter. Chrome/Edge on Windows, Edge on macOS, a representative school machine and independent GUI players remain untested.

This is a diagnostic, not the production student exporter. Open `/student/diagnostic/` using `npm run dev:previs`. The default fixture uses the existing `RealtimeRenderer` with GTAO, SSR, bloom and SMAA. `?raw` bypasses the post stack. The fixture contains proxy car/person/door geometry, two distinct camera/door states, an LED wall with encoded timecode and a click every second. Real studio assets, teacher media, narration mixing and authoring-store restoration remain integration gates.

## Verified results

| Check | Result |
| --- | --- |
| Short GPU export | 250 frames, 1920×1080, 25fps; hard cut at frame 125; H.264 High + AAC-LC 48kHz mono. About 1.58 s encode time in the final run. |
| LED readiness | Decoded samples, without sleeps or HTML video playback. Frames 0 and 124 resolve LED frame 25/time 1 s. Frames 125/126 resolve LED frames 12/13 at 0.48/0.52 s; returning to frame 0 restores LED time 1 s. |
| Physical sizing | CSS/DPR change to a 700×500 viewport at DPR 2 cannot change 1080p output. Fixed sizing bypasses the normal realtime display ceiling; normal rendering resumes afterwards. |
| Cancel/failure/retry | Browser cancellation and injected render failure both restore the prior diagnostic view; subsequent exports succeed; temporary OPFS entries are removed. Unit tests cover preflight/prepare/encode/disk/finalise/restoration failures and backpressure. |
| Synthetic 15-minute stream | Exactly 22,500 frames/900 s, 23,935,202 output bytes, 82.14 s encode time. It deliberately uses Canvas2D instead of scene/GPU/media decoding, as required by the early synthetic soak gate. |
| Queues | Native video encode queue maximum 4; software AAC worker maximum 1 pending encode command, 4096-byte input blocks. Every add/write respects backpressure. |
| Memory | Sampled JS heap peak 55.28 MB during the soak. After forced test GC: 12,152,860 bytes before, 12,359,840 after. This establishes bounded retained JS state for the synthetic run; it is not total browser/GPU/native/WASM memory profiling. |
| Independent FFmpeg | All 250 and 22,500 decoded video timestamps exactly match frame/25. All 10 and 900 audio clicks exist; onset error 21.354 ms throughout, below the 40 ms tolerance. AAC end padding 26.67 ms(short)/32 ms(long), also below 40 ms. |

The earlier native macOS AAC encoder emitted 44.02 ms priming delay and failed the one-frame target. The code now deliberately registers pinned `@mediabunny/aac-encoder@1.62.0`, paired with `mediabunny@1.62.0`, for one consistent AAC implementation across platforms and an AAC fallback where native support is absent. Its measured 21.35 ms priming is accepted within the plan's tolerance; no samples are thrown away and no OS-specific guessed delay is applied. See [AAC encoder documentation](https://mediabunny.dev/guide/extensions/aac-encoder) and the [upstream priming issue](https://github.com/Vanilagy/mediabunny/issues/444).

## Reproduce

From the repository root, with supported Node/Chrome installed:

```sh
npm run test:previs:browser
npm run test:previs:soak
```

Set `CHROME_PATH` for another Chromium executable and `PREVIS_ARTIFACT_DIR` for persistent evidence storage. The harness creates a separate Vite server with hot reload disabled; no user browser session is modified. It writes MP4s, a screenshot and a JSON report outside the repository. `PREVIS_HEADFUL=1` can run a visible browser.

Independent decoder checks require an installed FFmpeg executable:

```sh
python3 tests/browser/previs/verifyRasterMedia.py /path/raster-10sec.mp4 --frames 250 --ffmpeg /path/ffmpeg
python3 tests/browser/previs/verifyRasterMedia.py /path/synthetic-15min.mp4 --frames 22500 --ffmpeg /path/ffmpeg
```

The Python script uses only the standard library, streams video diagnostics and one-second PCM blocks, and writes `.ffmpeg.json` evidence. FFmpeg 7.1 was obtained in a temporary verification environment for this run; it is not an application dependency.

Current artifacts: `/tmp/student-previs-verified-20261022/report.json` and neighbouring MP4/FFmpeg reports. Earlier raw/post/native experiments remain separately under `/tmp/student-previs-*`. An initial MSAA-enabled post-stack experiment failed because GTAO requires a single-sample depth texture; the diagnostic now matches the engine's non-MSAA configuration and uses SMAA. One memory rerun was interrupted by source hot reload; only the completed rerun above counts as evidence.

## Ownership and engine boundary

`RasterMP4Exporter` pumps one raster frame and one 1920-sample mono audio block at a time, using integer frame indices and timestamp frame/25. Fragmented MP4 streams through a 1 MiB-chunked target to device-backed storage. `DecodedLEDSource` awaits a decoded video sample and closes it after drawing; generation IDs prevent stale A→B→A completions from painting. Browser and unit tests cover the distinction between decoder completion and authoring state.

User diagnostic exports stream directly to a chosen file. Harness files use OPFS and are inspected/streamed before deletion: an OPFS `File` becomes unreadable once its backing entry is removed. A failed direct file export can leave a partial output file; the diagnostic reports failure and never labels it complete.

Shared engine changes are optional `RealtimeRenderer.render({width,height})`, explicit `setEnvironment(texture|null)` to prevent stale HDRI inheritance, and stable light-proxy synchronization to avoid repeated GPU shader/uniform allocations at cuts. The app-owned adapter retains control of camera aspect and state. There is no scene hydration, BVH rebuild, admin-store mutation or authoring history per exported frame.

## Remaining release gates

- Full supported studio/car/human/door fixture, actual camera/pose/environment/media ports and student sequence evaluator integration.
- 15-minute real-scene output with narration, target hardware/OS/browser matrix, native/GPU process memory and independent player checks.
- Production cancellation at every phase, file-space preflight, output cleanup/retry, codec errors and renderer-loss handling.
- Production scene fidelity matching the existing admin raster renderer, with the accepted framing/exposure/visible LED scope and 50% framing bars. See accepted answers in `STUDENT_PREVIS_QUESTIONS.md`.

## Confirmed decisions and current checkpoint verification

The user confirmed the existing admin raster appearance is sufficient initially:
framing, exposure and visible LED imagery; extra raster DOF/LED illumination is
not required for launch. Narration is the only exported soundtrack; library
video audio remains muted. Output is still a full 1920×1080 MP4.

The current short proof now evaluates a frozen student sequence through
`SequenceRasterAdapter`. Its first shot uses 4:3 and second uses 2.40:1, composited
at 50% black over the full image in both the displayed preview and encoded frame.
Exact Canvas2D samples prove half brightness outside framing and unchanged
centre pixels. Twelve corresponding decoded H.264 pixel comparisons pass within
12 code values (lossy compression tolerance). Unit geometry checks prove the
240-pixel side and 140-pixel top/bottom bounds. Admin DOM guides are unchanged.

Artifacts: `/tmp/student-previs-answers-framing-20261022/report.json` and
`raster-10sec.ffmpeg.json`. Current short encode: 250 frames in 1.66 seconds,
1,413,607 bytes. Independent FFmpeg again verifies all 250 timestamps exactly,
10 audio clicks at 21.354 ms onset delay and a 26.67 ms AAC tail. Cancellation,
injected failure, subsequent export and OPFS cleanup also pass.

Host identification confirms **Apple M5, Mac17,2, 10 CPU cores, 16 GiB RAM**.
The later actual-scene 15-minute proof now covers this baseline chip. Teacher
media/narration and the remaining browser/OS/player matrix remain separate gates. The original local proof checkpoint is
complete; the complete Phase 1/platform release gate remains open.


## Actual scene implementation checkpoint

The separate [real-scene proof](STUDENT_PREVIS_REAL_SCENE.md) now exercises 97
actual studio/SUV/mannequin/LED meshes, verified GLB bytes and stable glTF node
mappings through concrete ThreeShotPorts and the transactional shot adapter.
Standing/sitting changes update real vertex positions, doors use authored hinge
TRS, the wall displays decoded timecode with explicit native UVs/nits/placement,
and the camera/light/appearance state restores after stop/cancel/failure.
The 250-frame GPU/MP4 run passed on the base M5, with exact frame timestamps,
ten click onsets, twelve encoded framing pixel checks and stable renderer
resource counts. Current short evidence is
`/tmp/student-previs-real-scene-memory-fixed-20261022/`.

This advances the earlier proxy-only diagnostic but remains an explicitly local
engineering fixture: it uses generated timecode and click audio, has no remote
teacher catalogue or microphone narration, and does not claim arbitrary imported
student projects can render. HDRI preparation, true offline media and the browser/
player acceptance matrix remain separate gates.


The subsequent actual-scene long proof passed: all 22,500 frames / 900 seconds
encoded in 450.06 seconds, 605,057,501 bytes streamed. Independent FFmpeg verifies
all frame timestamps and 900 clicks at 21.354 ms constant delay (32 ms AAC tail).
Native video queue ≤4, software AAC pending command ≤1, input blocks ≤4096 bytes.
Sampled JS peak 167.8 MB; warmed retained JS increases 3.79 MB after the long
export. Tracked renderer resource counts stay unchanged through export/retry,
with 529.3 MB tracked allocations. Total process/GPU residency remains unmeasured.
See the real-scene document for exact byte counts, failures/retries and scope.
