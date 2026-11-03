# Student voiceover recording

Open http://localhost:5173/student/?ui=editor and open a project.

1. Set the playhead where the voiceover should begin.
2. Click **Record voiceover** in the timeline footer and allow microphone access.
   The scene plays while recording; existing voiceovers are silenced during the take.
3. Click **Stop recording & save**. Recording also stops at the end of the picture
   sequence, or after 15 minutes. The complete take is saved on this browser and
   a clip appears on the independent Voiceover track.
4. Press Play or Space to hear the voiceover with the sequence. Pausing, stopping
   and seeking stop its audio immediately; resuming uses the new playhead position.

Drag a voiceover clip to move it. Drag either edge to trim its source audio.
Focus a clip and use Left/Right to move one frame, or Shift+Left/Right for a second.
Focus a trim handle and use Left/Right to trim. Click the clip's trash button or
press Delete/Backspace while it is focused to delete it. Undo/Redo includes moves,
trims and deletion. Shot placements also have trash buttons and retain their
existing reorder/duration controls.

Voiceover is independent of shots: reordering or changing shot durations does not
move the recording. Audio outside the picture sequence is retained for later
editing but playback ends with the picture sequence. Extend shots to hear it.

## Local storage

Encoded microphone files and verified audio metadata live in a separate
`RayzeeNarrationDB` IndexedDB database. Project clips/edits remain in the existing
`RayzeeStudentDB`, with one project revision per completed edit. The file saves
before the project gains its reference, so a failed file save creates no dangling
clip. SHA-256 is checked when decoding stored files after reopening.

Files and placements survive page reloads. Completed takes are local to this
browser and origin; there is no recording upload. JSON export contains references,
not microphone files. Clearing browser data removes these files. Clip deletion
retains the source file so Undo/Redo and earlier project revisions can restore it.

Capture uses MediaRecorder, then decodes the complete encoded container to determine
sample rate, channel count and exact source sample length. Chunks are combined;
individual MediaRecorder chunks are never assumed independently decodable. Trims
are bounded to the real source and retain at least one sample. Web Audio schedules
trimmed source offsets, overlap and gain against the sequence clock.

During capture the UI shows recording/saving state and blocks project changes.
Leaving with a live/unsaved take triggers the usual unsaved-work prompt. A failed
file write retains the take in the tab: use **Retry voiceover save**, or explicitly
**Discard take**. Microphone tracks stop on completion, failure and disposal.

## Verification and remaining original-plan gates

Automated microphone checks use Chrome's fake audio device, never the user's mic.
Run `npm run test:previs:voiceover`. The browser test covers capture, native file
storage/reload, source trims, pointer dragging, Web Audio scheduling, delete/undo,
shot deletion and a real injected IndexedDB write failure followed by retry.

This completes local recording and basic timeline editing. Incremental recording
recovery after a tab/browser crash, device selection/count-in, real waveform,
gain/mute UI, mixed shot/audio selection, narration uploads, audio packages,
MP4 mixing, long-duration drift/memory measurements and the full platform matrix
remain separate gates from the original plan. In-progress takes are held in memory
until Stop; only completed saves are durable across reloads. Microphone permission
requires HTTPS or localhost and a browser with MediaRecorder and Web Audio support.
