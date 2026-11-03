# Cloudflare deployment for agents

## Current account release — 2 November 2026

The account/project release is deployed at `https://vp-previs.pages.dev`,
deployment `198ebc0c-de89-411a-ac3f-4348c6dc12b1`. Local development, preview and
production use D1 `vp-previs-student` and R2 `vp-previs-library` for all catalogue,
document and narration bindings. Migrations 0007–0011 and the revision-113
versioned default are active. Preview and production Chrome 156 workflows passed.

See `SHARED_CLOUDFLARE_DEVELOPMENT.md` for bindings, admin access and rollback;
`USER_PROJECT_SYSTEM_PLAN.md` contains verification evidence and backup locations.
The historical security and deployment notes below describe earlier states and
are superseded by this release record where they conflict.

## Security integration gate — 22 October 2026

**The historical 19 October static upload procedure below is not a complete
deployment procedure for the newly protected application.** The current code adds
repository-root `functions/_middleware.js` to protect the admin HTML/static site
as well as admin APIs, and to restrict all online routes to Australian requests.
No such protection has been deployed to the existing live site in this session.

Any future authorized preview must include Functions from the repository root,
not merely `app/dist`, with every route (including static assets) invoking the
middleware: generated `_routes.json` must include `/*` and exclude nothing. Do
**not** use dashboard drag-and-drop/static-only publishing that omits Functions.
Do not reuse an old static deployment artifact as evidence of protection.

Build the matching student asset manifest and files, supply the server-only
password verifier/session secret and migrated `ADMIN_AUTH_DB` binding, and
explicitly configure the intended hosted environment and authentication activation.
The edge validates public asset bytes against that manifest and fails closed on
fallback HTML or mismatches. Hosted password verifiers use 100,000 PBKDF2-SHA-256 iterations, the Cloudflare Workers native limit. Use a long, randomly generated password; ephemeral low-work test verifiers are rejected. Keep
secrets out of `VITE_*` and browser bundles. `npm run check:pages` in `backend/`
locally compiles the actual Functions and all-route manifest without deploying.

Full contract, local evidence and remaining hosted checks:
[`STUDENT_PREVIS_ADMIN_SECURITY.md`](STUDENT_PREVIS_ADMIN_SECURITY.md). Country
checks apply to network requests; previously downloaded offline files cannot be
recalled or geolocated offline. Credentials and historical upload notes below
remain reference material, not authorization to deploy.

## Target and credentials

- GitHub: `LEDvolume-studio/VP-Previs`, production branch `main`.
- Cloudflare **Pages** project: `vp-previs`; production: <https://vp-previs.pages.dev>.
- Work from the `rayzee-renderer/` repository root. Its parent `3D-Editor/` is only a local workspace directory; Cloudflare's Git checkout starts at the repository root.
- Local credentials are `../GITHUB-access-token` and `../CloudFlareToken.txt`. Read them into process memory/environment only; never print, commit, or put them in browser assets. Use the Cloudflare file's **Your API Token** value for Pages; the S3 credentials are for R2.
- The separate `vp-previs` Worker has its workers.dev route and previews disabled. Use `wrangler pages deploy`, which uploads the built app without requiring a Wrangler config.

## Build and deploy a preview

Use Node 22 (tested: 22.22.3). On this machine, if Node is absent from PATH:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v22.22.3/installation/bin:$PATH"
```

With dependencies installed, build from the repository root:

```sh
# Fresh checkout: npm ci
npm run build
```

Output is `app/dist`. Preserve `app/public/_headers`: it supplies `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, needed for cross-origin isolation. Keep individual assets below Cloudflare's 25 MiB limit; the Vite plugin already excludes ONNX Runtime WASM files loaded from CDN.

Run this from the repository root to verify GitHub access and upload a preview with credentials loaded from the local files:

```sh
python3 - <<'PY'
import json, os, subprocess, urllib.request
from pathlib import Path

repo = Path.cwd()
lines = (repo.parent / 'CloudFlareToken.txt').read_text().splitlines()
env = os.environ.copy()
env['CLOUDFLARE_ACCOUNT_ID'] = lines[lines.index('Account ID') + 1].strip()
env['CLOUDFLARE_API_TOKEN'] = lines[lines.index('Your API Token') + 1].strip()
env['WRANGLER_SEND_METRICS'] = 'false'
env['CI'] = 'true'
github_token = (repo.parent / 'GITHUB-access-token').read_text().strip()
request = urllib.request.Request(
    'https://api.github.com/repos/LEDvolume-studio/VP-Previs',
    headers={'Authorization': 'Bearer ' + github_token, 'User-Agent': 'deployment-check'})
with urllib.request.urlopen(request, timeout=30) as response:
    assert json.load(response)['full_name'] == 'LEDvolume-studio/VP-Previs'
subprocess.run([
    'npx', '--yes', 'wrangler@4.151.1', 'pages', 'deploy', 'app/dist',
    '--project-name', 'vp-previs', '--branch', 'agent-deployment-test',
    '--commit-dirty=true',
], cwd=repo, env=env, check=True)
PY
```

The non-production branch creates a preview. Only use `--branch main` when production deployment is requested. Report the deployment URL returned by Wrangler; long branch aliases can be truncated. A local upload includes the current build, including uncommitted source changes; rebuild immediately before deploying.

## Verify and troubleshoot

- Fetch the preview root and its referenced JS/CSS, WASM, DLSS runtime, and bundled GLB files. Check HTTP 200, expected content/MIME types, and both isolation headers. Compare downloaded bytes with `app/dist` to detect SPA fallbacks hiding missing assets. Use `curl` for these checks: Python's default urllib client received HTTP 403 during testing while curl succeeded.
- Confirm the Pages API reports `environment: preview` and that the project's `canonical_deployment.id` is unchanged. HTTP checks establish successful delivery; use a WebGPU-capable browser to verify rendering, imports, and neural passes separately.
- Current Pages Git integration: root `/`, build `npm run build`, output `app/dist`, production branch `main`. Pushing `main` can trigger production deployment. The GitHub `release.yaml` workflow separately publishes npm releases and GitHub Pages; do not dispatch it as a Cloudflare deployment test.
- Set required `VITE_*` values before the build; a direct upload does not inject the Pages dashboard's build variables. The tested preview used no `.env`; optional account sign-in and Sketchfab downloads were not tested.
- If npm fails with `TypeError: Config is not a constructor`, the local `node_modules/npm` installation is broken. Build in a clean temporary copy containing the current `app/` and `rayzee/` sources plus root `package.json`/`package-lock.json`, excluding all existing `node_modules` and `dist` directories; run `npm ci` then `npm run build` there. Preserve the original worktree and pass the resulting absolute `app/dist` path to Wrangler. This was required on the test machine.
- The old log's `workspace root` error came from plain `npx wrangler deploy`; the Pages command above explicitly targets the static output.

## Recorded test — 19 October 2026

GitHub access and the Cloudflare account token were verified. A clean `npm ci` and full `npm run build` succeeded from local HEAD `85b3825f5b724cf0a4e9da953d831bb674c1c61c` plus uncommitted changes. Wrangler 4.151.1 deployed 125 served files (about 17.4 MB total) and `_headers` to <https://76e67a2e.vp-previs.pages.dev>, using branch `agent-deployment-test-2026-10-19`. All 125 files downloaded successfully, matched the build byte for byte, and included both isolation headers; WASM MIME checks passed. The Pages API confirmed a preview deployment and production remained on deployment `386eab79-f44d-4a2c-8f1c-cff0334aedf0`. Browser/WebGPU rendering was not tested.

References: [Pages upload from CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
