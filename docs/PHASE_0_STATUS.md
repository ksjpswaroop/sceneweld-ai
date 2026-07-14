# Phase 0 status and evidence

- Last verified: 2026-07-14
- Scope: repository trustworthiness and delivery foundations
- Overall status: **Implementation complete locally; two external proofs pending**

## Exit-criteria audit

| Requirement                                                     | Status                                  | Authoritative evidence                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obtain and record product-name clearance before public branding | Pending external proof                  | `docs/brand/NAME_CLEARANCE.md` records the rejected SceneWeld candidate, the screened SceneMeld candidate, and the remaining legal/app-store checks. Source identifiers remain OpenCut.                                                                                                                                                           |
| Commit Cargo and Bun lockfiles                                  | Complete locally                        | Root `Cargo.lock` and per-application `apps/api/bun.lock` and `apps/web/bun.lock` are included in this Phase 0 commit; both Bun installs pass with `--frozen-lockfile`, and Cargo check/build/test/clippy pass with `--locked`.                                                                                                                   |
| Replace `latest` dependencies with reviewed versions            | Complete                                | Manifest/lockfile search finds no `latest`; previously floating TanStack, Elysia, Cloudflare, and Wrangler dependencies are exact.                                                                                                                                                                                                                |
| Fix TypeScript errors and Vitest/Cloudflare configuration       | Complete                                | Web `tsc --noEmit` passes; Vitest runs in an isolated jsdom config and passes one shell test. The calendar, scroll-area, and spinner type errors are fixed.                                                                                                                                                                                       |
| Fix Moon API output declaration                                 | Complete                                | Wrangler dry-run uses `--outdir dist`; Moon observes the declared `dist` output and `api:build` passes.                                                                                                                                                                                                                                           |
| Add format, lint, type-check, unit test, and build tasks to CI  | Complete locally                        | `moon ci` passes 15 eligible tasks. Web/API use Prettier and Oxlint; both type-check and test; Rust uses fmt, clippy with denied warnings, tests, locked check, and locked release build. Deploy/dev tasks are excluded. Runner OS versions and action commits are pinned; Linux receives GPUI libraries; Windows output globs include `.exe`.    |
| Record the shared Rust-core and web/WASM boundary               | Complete                                | Accepted ADR at `docs/decisions/0001-shared-rust-core-and-web-wasm-boundary.md`.                                                                                                                                                                                                                                                                  |
| Package a signed or reproducible desktop artifact in CI         | Workflow complete; hosted proof pending | The CI packaging job runs on pinned `macos-15` ARM64, verifies both runner and Mach-O architecture, builds with `cargo --locked`, creates a normalized ZIP plus SHA-256 sidecar, recreates it, and compares bytes. Local verification produced two identical archives. A GitHub Actions run is still required to prove the hosted job and upload. |

## Verified commands

```sh
cd apps/web && bun install --frozen-lockfile
cd apps/api && bun install --frozen-lockfile
moon ci
python3 scripts/package_desktop.py \
  --binary target/release/opencut-desktop \
  --output dist/phase0-package-check/first.zip
```

Latest local deterministic-package SHA-256:

```text
13db2cf77603b33ca3e8ba9740fa76420787ac23ceafabeac46326ca43e5813f
```

The checksum is evidence for the current local binary, not a permanent release checksum; a clean CI build will have its own published checksum.

## Test counts and limitations

- Web: 1 passing Vitest shell test.
- API: 5 passing behavior tests covering root, health, valid echo, invalid echo, and unknown route.
- Desktop: locked build/check/clippy/format pass; Cargo currently discovers 0 unit tests because the application remains a shell.
- Workflow syntax and embedded shell pass actionlint 1.7.12 and ShellCheck; pinned action commits resolve to the recorded release tags.
- The current app is still not a video editor. Phase 0 makes the repository reproducible and verifiable; media editing begins in Phase 1.

## Remaining actions before Phase 0 is formally closed

1. An authorized maintainer obtains the trademark/app-store/common-law review and records an approved or rejected SceneMeld decision.
2. Push the changes through a writable fork/branch and retain a successful GitHub Actions run showing the three-platform verification matrix and uploaded macOS artifact/checksum. The authenticated account has `push: false` on `OpenCut-app/OpenCut`, so it cannot create this proof directly against upstream.
