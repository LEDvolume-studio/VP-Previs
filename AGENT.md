# Agent Guidance

Rayzee is a fork that will continue to receive upstream merges. Make changes easy to identify, test, and carry forward.

## Working principles

- Preserve the project's UI, workflow, persistence, and Unreal-style camera/control customizations.
- Prefer small, focused additions over broad rewrites of upstream engine code.
- Keep app-specific behavior in `app/` or behind narrow engine APIs when practical.
- When engine changes are necessary, minimize the diff, document non-obvious integration points, and add regression tests.
- Before changing shared engine code, inspect relevant history and distinguish local behavior from upstream behavior.
- During upstream merges, prefer upstream engine architecture while explicitly reapplying and testing required local UI/control integrations.
- Preserve unrelated user changes and never discard or overwrite work without explicit direction.

## Reference depth

Read [`docs/CLOUDFLARE_DEPLOYMENT.md`](docs/CLOUDFLARE_DEPLOYMENT.md) for Cloudflare Pages deployment, local credential handling, preview testing, and the verified deployment procedure.

Read [`DETAILED-AGENT.md`](DETAILED-AGENT.md) when working on engine architecture, WebGPU/TSL shaders, rendering stages, BVH or scene processing, workers, denoising, state synchronization, large-scene memory, or other unfamiliar/high-risk areas. Routine and narrowly scoped requests do not require loading all of that detail.

## Quality and delivery

- Follow existing patterns and use conventional commit messages.
- Validate in proportion to risk: targeted tests first, then `npm test`, `npm run build`, or `npm run lint` when appropriate.
- Do not push, release, rewrite history, or perform destructive Git operations unless explicitly requested.
- Report important assumptions, merge-sensitive changes, validation performed, and any remaining risks.
