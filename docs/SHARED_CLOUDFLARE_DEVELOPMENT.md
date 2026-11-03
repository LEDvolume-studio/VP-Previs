# Shared Cloudflare development storage

The Vite development bridge in `app/build/localStudentBackend.js` uses remote
bindings from `backend/wrangler.shared.jsonc`. It does not create, migrate or seed
an isolated development database and does not fall back to one if Cloudflare is
unavailable. Automated Worker and browser tests continue to use isolated fixtures.

| Binding | Shared resource |
| --- | --- |
| `DB`, `ADMIN_AUTH_DB` | D1 `vp-previs-student` (`68cb01ea-7596-4d5e-b2e3-38fb88c59991`) |
| `LIBRARY`, `DOCUMENTS`, `NARRATION` | R2 `vp-previs-library` |

The three R2 bindings use the same physical bucket; application object keys keep
catalogue, account documents and narration separate. Review cleanup changes with
that shared bucket boundary in mind.

The bridge reads the existing Cloudflare API credentials and production admin
verifier/session secrets from private local files. They stay server-side and are
not copied into `VITE_*` variables, browser bundles or request errors. API and
sign-in access to the bridge requires a loopback socket peer. Requests are bounded
before buffering their bodies, and the Worker still enforces its route-specific
limits and authentication.

Local application writes through this bridge affect shared Cloudflare data. Use
`http://localhost:5173/` or `http://127.0.0.1:5173/` after starting the existing
Vite development command. Startup performs a read-only catalogue query to verify
the connection and reports failure rather than starting an isolated substitute.

## Verification and release state

Read-only checks on 2 November 2026 confirmed that local and production
`GET /v1/catalogue` return identical parsed responses (four available presets),
and the shared D1 connection contains eighteen registered catalogue assets.
Three focused tests cover credential parsing, bounded request buffering and
loopback peer enforcement; lint passes for the bridge and tests.

Release completed 2 November 2026. Additive account migrations 0007–0011 are
applied; Pages preview and production bind all three R2 names to the same bucket.
The verified production build is `198ebc0c-de89-411a-ac3f-4348c6dc12b1`, at
<https://vp-previs.pages.dev>. Its hosted Chrome 156 test passed account login,
offline scene/audio editing and reopen, exact sync, admin review and revocation.
A local-created account was accepted by production and both origins returned
identical document/audio bytes. Local issued links use the production origin.

The admin account screen is `/admin/users/` on both local and production origins.
Sign in with the existing admin password, create a student with first name, last
name and graduation year, then issue and copy their link for manual distribution.

Backups and non-secret verification records are in
`.local-runtime/shared-cloud-backup-20261102/`. All 32 original R2 objects retain
their original sizes and ETags; release-check projects were archived and their
accounts revoked. See `USER_PROJECT_SYSTEM_PLAN.md` for the full evidence.

## Account activation and rollback

Account activation is separate from the old device capability draft service.
`ENABLE_ACCOUNT_API=true` enables the account routes. Hosted preview/production
also require `ENABLE_HOSTED_ADMIN_AUTH=true`, `ENABLE_DRAFT_API=false`, HTTPS,
and all required database/bucket bindings. The legacy `/v1/drafts` endpoints
remain restricted to local/test environments and are disabled in shared local
configuration. The Australia gate and admin same-origin/session checks remain
in front of every hosted route.

`backend/cloudflare-account-bindings.json` records the non-secret Pages binding
and account-variable fragment. Merge it into both preview and production
`deployment_configs`; preserve all existing secrets, catalogue/plate variables,
other bindings and build settings. Set `ENVIRONMENT` to the corresponding
`preview` or `production` value. This file is a deployment input, not evidence
that Cloudflare has been changed. Apply additive migrations `0007`–`0011` only
after a verified backup, and publish the selected revision-113 default through
the verified API. Keep the earlier fixed-key default and its backups intact.

For a write-only incident, set `ENABLE_ACCOUNT_WRITES=false` on both local and
hosted deployments: existing account reads and exports remain available, while
new account, project, default and narration mutation requests return 503. To
stop all account access set `ENABLE_ACCOUNT_API=false`. These switches affect
new requests and do not recall data already downloaded. Stop or roll back the
matching application build as required; retain D1 tables, R2 objects and local
IndexedDB schemas. Never drop account tables, prune immutable revisions, or
restore an old whole-database export over newly created user work as rollback.
Keep `ENABLE_DRAFT_API=false` throughout rollback. Re-enable only after the
matching code, schema and dependency checks pass again.

A compatible rollback build must retain the account gate and storage schema.
If returning to the pre-account build is necessary, first disable account access
and writes so it cannot act as an anonymous account editor, and preserve all
account data for the corrected release. Keep the earlier default version
available for a conditional pointer rollback; changing the default never changes
existing student projects.
