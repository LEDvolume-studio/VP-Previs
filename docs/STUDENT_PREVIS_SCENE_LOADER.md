# Verified student scene loading

Status: 22 October 2026. `VerifiedStudentSceneLoader.js` adds an app-owned loader
for a supported self-contained GLB scene. `BundledStudentScene.js` supplies exact
SHA-256 hashes, byte sizes and node maps for existing local studio, SUV, mannequin
and main LED wall files. These are local integration fixtures, not teacher-published
catalogue entries or an assertion of redistribution rights.

## Host integration

```js
import { createBundledStudentSceneManifest } from '../fixtures/BundledStudentScene.js';
import { loadVerifiedStudentScene } from './VerifiedStudentSceneLoader.js';

const manifest = createBundledStudentSceneManifest({
  models: ['studio', 'suv', 'mannequin', 'led'],
});
const loaded = await loadVerifiedStudentScene(manifest, { signal });
scene.add(loaded.sceneRoot);
loaded.assertReady();
// Create the host's canonical lights, pose/environment/media services and
// ThreeShotPorts using the verified maps. Call loaded.dispose() on replacement.
```

The default fixture selection is `suv`, `mannequin`, `led`; the studio is an
explicit option. Each call returns detached manifest records. Only `assets` and
`baseScene` belong in portable project JSON. Runtime `source` paths stay in the host. Local node selectors come from its trusted
fixture registry; published selectors now come from an immutable server-verified
supported scene definition. Imported project JSON must never be accepted as that
registry. See [supported scenes](STUDENT_PREVIS_SUPPORTED_SCENES.md). Before accepting an imported document, the host
must compare its asset identities **and full immutable metadata** with the trusted
registry. A matching `assetId@version` alone does not authorize different bytes.

`loadVerifiedStudentScene(manifest, options)` returns:

| Field | Contract |
| --- | --- |
| `sceneRoot` | Owned Three `Group`; loaded model scenes keep their native hierarchy and local transforms. |
| `nodeObjects` | `Map<instanceId, Object3D>` for every explicitly mapped source node and GLTF scene root. |
| `assets`, `baseScene` | Frozen portable manifest records for the verified files. |
| `lightObjects` | Empty Map. Canonical host lights require explicit creation and mapping. |
| `binding` | Frozen ready inventory for the transaction adapter; initially no light or LED playback inventory. Its `ready` getter becomes false on disposal. |
| `assertReady()` | Returns that same binding, or rejects disposed, detached or retargeted node maps. |
| `dispose()` | Invalidates readiness, disposes owned model allocations, detaches and clears the root. Safe to repeat. |

Stable fixture mappings are `${key}-root` for a model's loaded GLTF scene root
and `${key}-instance-${index}` / `${key}-node-${index}` for instance ID / node ID.
An embedded glTF node index has meaning only with this exact version and hash.
Its expected source name is also checked before parsing. Parsed objects resolve
through GLTFLoader's `parser.associations` node indices; display names, traversal
positions and random runtime UUIDs are never resolution fallbacks. Multi-primitive
GLTF nodes map to their authored parent group, with the renderer's primitive
children retained underneath. Every authored glTF node and the scene root must
be mapped exactly once. Missing, duplicate, stale and unresolved mappings reject.

The loader does not normalize units, center a model, rescale it, apply a human
pose, open doors, create lights or change LED UVs. It preserves GLB transforms,
skin weights, morph targets and metadata. Host preparation can use the existing
mannequin and LED helpers before publishing its complete rendering port set.
Owned geometry clones created by such preparation are included in cleanup.

## Byte and resource boundary

The default reader permits only absolute bundled `.glb` paths or strict catalogue
asset identity routes on the same origin,
with credentials for the local protected route, redirects disabled and browser
cache bypassed. It streams into the expected-size allocation and rejects an
oversized chunk before copying it. It copies supplied bytes, verifies their exact
size and SHA-256, and only then constructs a GLTFLoader. Local limits are 64 MiB
per model and 128 MiB total encoded model bytes; these are implementation limits,
not school storage policy or a total decoded/GPU-memory guarantee.

This initial capability accepts one embedded glTF 2 scene per GLB, all source
nodes reachable exactly once, one embedded binary buffer and embedded images.
External URLs, data URIs, missing nodes, embedded animation/cameras/lights and
unsupported extensions reject before parsing. Supported extensions are
`KHR_materials_emissive_strength` and `KHR_mesh_quantization`; compressed model
decoders and worker pools are deliberately absent. Each version appears once in
the current scene manifest; repeated instances of the same version need a future
explicit instancing extension to this loader.

An abort cancels fetch promptly. GLTFLoader parsing itself is not abortable;
cancellation during parsing waits for its outstanding dependencies, disposes
them and rejects without publishing a ready scene. Individual scene, mesh,
material and texture dependencies are tracked even if a sibling dependency
fails. A later model's integrity failure also disposes all earlier models.
Shared geometry, materials, textures, skeletons and closable image bitmaps are
disposed once. Cleanup attempts remaining resources after an individual failure;
the original load error and cleanup error are both retained if needed.

`fetchBytes(source, { signal, byteLength, asset })` is an optional trusted host
injection for an already verified storage reader; this loader still performs
its own hash/size checks. `createGLTFLoader()` is an optional trusted testing
injection. Neither is selected from a project document.

## Validation and remaining gates

Twenty-two focused tests pass. They parse the actual studio, mannequin and LED
GLBs using Three.js, check every stable mapping and authored local transform,
and parse the real SUV geometry/material hierarchy with only embedded image
decoding replaced for Node. Other checks cover byte mismatches before parser
creation, complete mappings, external-resource rejection, native streamed fetch
bounds, asynchronous manifest isolation, cancellation, parse failures, later
asset failures, replacement geometry ownership, stale mappings and cleanup
failure handling. Scoped ESLint is clean.

These CPU checks do not prove embedded SUV image decoding, WebGPU appearance,
posed mesh deformation, decoded LED video, full shot A → B → A or real-scene
long-duration export. The separate host rendering integration must supply that
evidence. The loader changes no shared engine or admin application code.


## Shared supported preflight — 23 October 2026

The loader now delegates structural GLB and complete mapping inspection to the
DOM-free `SupportedGLB.js` module also used during server publication. It validates
full chunk bounds, accessor/sparse spans and decoded allocation bounds before
GLTFLoader. Resource ownership/cancellation behavior is retained. The published
viewport supplies the anonymous verified catalogue byte reader, compares saved
metadata with server registration, and derives strict asset routes itself.
Declared human roots and LED UV/mesh capabilities receive additional publication
checks. The main workspace GPU proof verifies the same actual 97-mesh assets and
two complete snapshots against independent fixture pixels. Existing source-file
fixture status above remains historical; no production teacher catalogue was
published in this session.
