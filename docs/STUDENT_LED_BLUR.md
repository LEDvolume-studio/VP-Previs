# Student LED screen blur

Each presentation-version-1 LED wall can store an optional `blur` record:
`{ method: 'off' | 'fast' | 'gaussian' | 'lens', amount: 0..40 }`.
Existing projects omit it and retain their original appearance. It survives
project saves, cloud sync, export/import, timeline cuts and undo/redo. No database
migration is required; the shared project validator accepts the optional field.

The student inspector previews amount changes while dragging and commits once
on release. Blur applies to the LED's emissive texture in linear color space,
before the scene's exposure and tone mapping. People, vehicles and other scene
surfaces stay sharp. Reflections naturally see the blurred screen.

The WebGPU material uses one stable shader graph and uniforms for selection and
amount; method changes do not replace materials/textures or compile new graphs.
The amount is a sampling radius in pixels relative to a 1920-wide LED image,
independent of the decoded video's resolution or camera distance.

| Option | Kernel | Purpose |
| --- | --- | --- |
| Off / amount 0 | Original sample | Preserve the image |
| Fast (box) | 9 equally weighted samples | Low sampling cost |
| Gaussian | 25 Gaussian-weighted samples | Soft falloff |
| Lens (disc) | 48 equal-area samples across a circular aperture | Approximate lens defocus |

All kernels have unit energy. Lens blur is a sampled circular convolution of the
screen image, not depth-aware scene DOF or an optical simulation. These bounded
sampling kernels trade precision at large radii for real-time performance.
The implementation follows Three's documented texture sampling and node material
interfaces; see [TSL](https://threejs.org/docs/pages/TSL.html) and
[GaussianBlurNode](https://threejs.org/docs/pages/GaussianBlurNode.html) for the
library's blur/node conventions. The kernels here operate directly on the LED
material rather than the entire viewport.

## Playback comparison

The comparison button temporarily renders the selected wall's same two-second
video sample with Off, Fast, Gaussian and Lens at the selected amount (12 if zero).
It forces advancement of that sample even when the shot's wall is frozen.
Other wall content stays at the sample's baseline. Each method gets three warm-up
frames, followed by two seconds paced with requestAnimationFrame toward 25 fps.
Late frames are skipped as in the editor's playback clock.

Reported frame time includes media decoding/compositing, scene render, canvas copy
and GPU queue completion. FPS reports delivered frames per elapsed wall time;
the 95th percentile exposes slow frames. It is an end-to-end comparison, not an
isolated GPU shader timer. The selected view and timeline frame restore in a
finally block; comparison does not modify the saved project or undo history.
Keep the tab visible during measurement. Results are transient and depend on
the device, video, wall coverage, scene, other apps and browser scheduling.

Measured in Chrome 156 on the development Mac with the bundled studio/timecode
video, output 1920×1080 and amount 12:

| Option | Delivered FPS | Mean ms/frame | 95th percentile ms |
| --- | ---: | ---: | ---: |
| Off | 24.9 | 24.1 | 32.0 |
| Fast | 24.9 | 25.5 | 28.9 |
| Gaussian | 25.0 | 25.4 | 29.9 |
| Lens | 25.0 | 25.8 | 29.4 |

All four sustained the 25 fps target in that short fixture; small differences
between methods are within run-to-run variability. Run the comparison on target
hardware with the actual driving plate before choosing a preferred method.

Validation: all 918 student-domain tests passed; the WebGPU browser harness verifies
distinct rendered outputs, preview cancellation, stable resource IDs, transient
benchmarking, the inspector's 0–2 exposure range, removal of height/note, one saved
blur edit per drag and the four-row comparison table.
