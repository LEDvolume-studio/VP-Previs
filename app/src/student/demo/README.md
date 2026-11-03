# Local student progress review

These assets support the explicit **Open local demo** action in development. They are not a teacher publication, a hosted catalogue, or student production data. The entry point must remain behind `import.meta.env.DEV` in the student shell.

`studio-review.preset.json` is the complete supported snapshot and exact node mapping captured by the real hardware browser integration proof on 23 October 2026. Source: `/tmp/student-previs-shot-edits-release-check-20261023/supported-wide.preset.json`. The bundled studio, SUV, mannequin and LED wall are the existing public GLBs; their pinned sizes, SHA-256 hashes and mappings are checked against `createBundledStudentSceneManifest`.

`timecode.mp4` is the independently verified three-second, 25 fps generated clip from the same proof. It was created by `createTimecodeFixture` in `student/diagnostic/DiagnosticScene.js`. Keeping its 168,896 bytes stable allows locally saved demo edits to reopen after a page reload without silently changing media identity. It is generated test media, not teacher or uploaded content.

`createStudentDemoProject({signal} = {})` returns `{document, catalogue}` after verifying the bundled clip. The returned document has a fresh project ID and two detached editable shots. The second shot is derived through the production pure camera, model pose, light and LED edit helpers; it does not claim to be the separately captured close-up proof.

`createStudentDemoCatalogue()` creates the same exact-identity, byte-verified adapter for reopening saved demo projects. `isStudentDemoScene(reference)` recognizes only the pinned scene ID and version. Caller-supplied asset metadata must match the bundled metadata exactly; real bytes then pass through `StudentCatalogueClient` verification and the normal supported model loader. The adapter fetches only the known bundled file locations and never accesses an admin or teacher API.

The editor requests `createStudentDemoProject({matchAdmin: true})`. This applies
the curated `admin-appearance.json` from the actual admin export, revision 276:
mapped SUV material values, exposure, lights and the pinned
`environment/aristea_wreck_puresky_1k.hdr`. The HDRI is the same public asset used
by admin, retained locally with immutable metadata and normal byte verification.
The appearance record contains no original project identity or credentials.
The default factory remains the original diagnostic fixture for existing proofs.

Older editor studies offer **Open copy with admin appearance**. The action creates
a fresh project ID and preserves original cameras, placements, media and timing.
Only appearance, exposure and lights change; the source study remains untouched.
This is a development review aid, not general admin-project import/publication.
See `docs/STUDENT_PREVIS_RENDERER_PARITY.md` for the measured GPU comparison and
the remaining scene-layout/publication limitations.
