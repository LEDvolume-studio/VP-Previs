# Shared-password administration and Australia access gate

Status: 22 October 2026. The user's decisions are implemented as a local/test
security foundation: **one shared admin password, no admin user accounts, and
Australia-only access to the online application**. No production password was
created, no secrets were read, no hosted settings were changed, and no deployment
was performed. The existing live site has not gained this protection yet.

## Both the site and API are protected

`functions/_middleware.js` is a real repository-root Pages Functions entry. It
imports `backend/src/security/PagesSecurity.js`; the backend Worker uses the same
password/session and country checks. The middleware runs before static files,
not only before publishing API calls.

1. Every request first requires trusted `request.cf.country === 'AU'`. Missing,
   unknown and non-Australian country metadata are denied with 403. The code
   never trusts `CF-IPCountry`, `X-Country`, Access email, or other client headers.
2. `/admin/sign-in` serves a small password form. `/`, root index aliases,
   `/admin/*`, `/student/diagnostic/*`, `/student/scene/*`, admin chunks and unknown paths require an
   authenticated admin session. Unauthenticated HTML requests redirect to the
   form before fetching any protected static file. Authenticated admin responses
   use `Cache-Control: no-store` and prevent framing.
3. The student workspace, its service worker and its exact transitive static
   dependency graph are public **within Australia**. The build plugin emits
   `student/edge-public-assets.json`, containing exact paths, byte lengths and
   SHA-256 hashes. Diagnostic/admin entries are excluded. The middleware reads
   that manifest through the Pages `ASSETS` binding and verifies actual returned
   bytes before serving public content. It does not classify arbitrary `.js` or
   `/assets/*` URLs as public. A missing/malformed manifest, wrong content type,
   changed bytes, an admin HTML SPA fallback, or an admin JS alias fails closed.
   Redirects from public files may point only to another manifest-listed path on
   the same origin. Ambiguous encoded slash/dot/backslash aliases are rejected.
4. `/v1/*` reaches the Worker implementation rather than falling back to static
   HTML. The session endpoint is implemented. Other `/v1/admin/*` operations
   require authentication. Local/test `/v1/admin/catalogue/` operations implement
   versioned asset/preset publication; other unimplemented operations return 501.
   Hosted catalogue activation remains disabled. The prepared-v2 publishing screen is implemented at `/admin/student-presets/`;
   live editor capture controls remain pending. No authenticated response pretends that an unsupported
   operation happened.
   Anonymous draft capabilities and exact revision semantics are unchanged.

All middleware responses preserve the existing COOP/COEP isolation headers,
including the password form, authentication errors and redirects. Functions do
not rely on static `_headers` rules to supply them.

The country gate controls **network requests**, not physical data residency or
the location of a person/device with certainty. Geo-IP may misidentify networks
and VPN egress. An already downloaded offline shell or project cannot be recalled,
re-geolocated or blocked while offline. Melbourne usage is not a claim that all
Cloudflare storage/processing occurs in Melbourne. Hosting placement and school
retention remain separate decisions.

## Password and signed session contract

There are no email identities, user registrations, account tables or account
provider integrations. A server-side salted PBKDF2-SHA-256 verifier checks the
single password; the comparison uses workerd's constant-time
`crypto.subtle.timingSafeEqual`. The configured verifier has this format:

```text
pbkdf2-sha256$iterations$base64urlSalt$base64urlDerived32ByteHash
```

The salt must contain 16–64 random bytes. The hash is 32 bytes. The independent
session signing secret is exactly 32 random bytes in canonical unpadded base64url.
Provision both as **server-only secrets**, never `VITE_*` values, application
JavaScript, checked-in configuration, or arguments containing a real password.
No default password/verifier/signing secret exists.

Hosted activation requires `ENABLE_HOSTED_ADMIN_AUTH=true` and a verifier with at
least **100,000 iterations**. Cloudflare's deployed Workers runtime rejects native
PBKDF2 derivations above 100,000 iterations, although the local test runtime may
accept them. Use a long, cryptographically random admin password: the reduced work
factor is not suitable for relying on a human-chosen password's strength. Local/test
environments accept 1,000 iterations solely for ephemeral tests.

| Server binding | Contract |
| --- | --- |
| `ENVIRONMENT` | `local`/`test` for development; explicit `preview`/`production` when reviewed for hosting |
| `ADMIN_PASSWORD_VERIFIER` | Server secret in the format above; hosted minimum 100,000 iterations; deploy with 100,000 for Cloudflare Workers |
| `ADMIN_SESSION_SECRET` | Server secret: canonical base64url of 32 cryptographically random bytes |
| `ADMIN_AUTH_DB` | D1 binding with `0003_admin_password.sql` applied; stores only global login attempt counters |
| `ADMIN_SESSION_SECONDS` | Finite technical default 3,600 seconds; configurable 60–86,400 seconds |
| `ADMIN_LOGIN_ATTEMPTS_PER_MINUTE` | Technical default 10 across the whole instance; configurable 1–1,000, enforced in D1 before password derivation |
| `ENABLE_HOSTED_ADMIN_AUTH` | Defaults disabled in checked-in configuration; hosted activation requires explicit `true` |
| `ALLOW_LOCAL_GEO_EXEMPTION` | Only explicit `true` with `ENVIRONMENT=local` or `test` exempts local requests; hosted environment names cannot use this exemption |

The one-hour session and login attempt defaults are implementation safeguards,
not school retention or password policy. The global throttle intentionally avoids
trusting an IP header; an attacker can consume that shared budget until its next
minute. Evaluate/tune additional platform abuse controls before a hosted pilot.

| Route | Behavior |
| --- | --- |
| `GET /admin/sign-in` | Same-origin HTML password form; returns 503 when password protection is unconfigured |
| `POST /v1/admin/session` | JSON `{password}` or the form's URL-encoded password; verifies password and sets session cookie; JSON returns authentication/expiry metadata, form success redirects to `/` |
| `GET /v1/admin/session` | Requires valid session; returns `{authenticated:true, expiresAt}` without returning the cookie value |
| `DELETE /v1/admin/session` | Requires a valid session and same-origin request; clears this browser's cookie |

The cookie is `__Host-rayzee-admin`, `HttpOnly`, `Secure`, `SameSite=Strict`,
`Path=/`, with no `Domain` attribute and finite `Max-Age`. Its HMAC-SHA-256 signed
payload contains an expiry, issued time, nonce, exact origin and credential
version. Tampering, expiry, future-issued cookies, another origin or a changed
password verifier invalidates it. Rotating the signing secret invalidates every
session. Logout clears the current browser cookie; a previously stolen cookie
remains valid until expiry or a verifier/signing-secret rotation. There is no
per-session revocation registry in this slice.

All login/logout and other cookie-authenticated writes require `Origin` exactly
equal to the request origin; a supplied `Sec-Fetch-Site` must be `same-origin`.
There is no cross-origin cookie-auth API or CORS allowance. HTTPS is mandatory
except explicit local/test requests to loopback hosts. Login request bytes are
bounded to 4 KiB before parsing; password input is bounded to 1,024 UTF-8 bytes.
Errors are static/redacted, and password/cookie/body logging is not added.

## Local proof and deployment gate

From `backend/`, run `npm test` and `npm run check:pages`. The latter compiles the
actual repository-root Pages middleware with pinned Wrangler, without uploading.
Its generated `_routes.json` has `include: ["/*"]` and no excluded static paths.
The security integration tests also execute that actual generated Pages bundle
inside Miniflare with an `ASSETS` service binding and real D1 authentication
budget storage. Test passwords/verifiers/signing keys are randomly generated in
process memory for the fixtures; no production password is created.

Nine security integration groups cover manifest graph/hash generation,
static/API authentication, no protected static fetch before redirects, signed
cookie attributes, finite expiry, logout, forged/expired/future/wrong-origin and
changed-verifier sessions, cross-origin writes, real D1 login throttling, missing
configuration, admin JS/HTML alias/fallback rejection, trusted AU/missing/foreign
country handling, spoofed headers, diagnostic protection, actual Pages packaging
and route coverage, and hosted activation with the real 600,000-iteration
verifier. The existing fourteen draft/storage groups still run separately.

Before any authorized hosted preview, create the real private verifier/signing
secret, configure the Pages runtime bindings and migrated auth database, preserve
the middleware's all-route invocation, build the matching manifest and assets,
and test real browser cookies plus actual Australian/foreign request metadata.
Do not use a static-only upload that omits Functions. The separate draft backend
remains hosted-disabled. Publishing endpoints, hosted abuse limits and geographic
delivery/data-placement acceptance are still release gates. See the prominent
note in [deployment guidance](CLOUDFLARE_DEPLOYMENT.md).

Runtime references: Cloudflare [Pages middleware before static
files](https://developers.cloudflare.com/pages/functions/middleware/), [Functions
context and ASSETS](https://developers.cloudflare.com/pages/functions/api-reference/),
[all-route invocation](https://developers.cloudflare.com/pages/functions/routing/),
[trusted request country metadata](https://developers.cloudflare.com/workers/runtime-apis/request/),
and [constant-time crypto comparison](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal).


## Lazy student renderer and private publisher — 23 October 2026

The exact public build graph now includes reachable lazy student renderer/decoder
chunks. Its nested dynamic dependencies are followed only for edge authorization;
the offline shell still caches only static editing dependencies. Manifest hashing
uses a `generateBundle` hook with explicit post order, after Vite's lazy preload
rewrites. The native offline harness independently re-reads every emitted public
file and verifies final SHA-256/length. This prevents a valid-looking manifest
from rejecting post-transformed student code at the edge. No suffix wildcard or
admin entry was made public.

Admin publisher HTML aliases remain covered by `/admin/` password protection;
its JavaScript entry is absent from the public graph. Real compiled middleware
fixtures test anonymous lazy-module reads and protected publisher aliases. The
publication browser proof uses a separate admin cookie jar and credential-free
student catalogue requests. Hosted activation remains disabled.
