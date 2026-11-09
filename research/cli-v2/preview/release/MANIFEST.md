# node-assets-cli 0.1.0 — release artifact manifest

Public evidence copy added 2026-11-09. Temporary installation paths are redacted; commands, metrics, commit identities,
and hashes are retained. Tarballs remain local, so the paths below describe the original artifact layout, not files
committed here. Documentation publication does not create a new package or release.

## Current candidate

| Field | Value |
|---|---|
| File | `release/node-assets-cli-0.1.0.tgz` |
| sha256 | `8e111cc117d39d5640b7a93539bc46d1ce1e92f80884d543bc6bb14b6bff9b76` |
| npm shasum (sha1) | `ce16393029a670df894174b522c1cd1a5b2775b6` |
| Size | 5.0 MB packed, 18.1 MB unpacked, 305 files |
| Source commit | `ab42afe1ac1816cc4232b89bc123375c82d3dfbd` (branch `cli-redesign-v2`; confirmed on the fork on 2026-11-09) |
| Built | started 2026-10-26T01:55:48Z; Node v22.20.0, pnpm 11.9.0, macOS |
| Command | `rm -rf packages/cli/dist && pnpm build && cd packages/cli && npm pack --pack-destination <release dir>` (established path) |

Clean-tree evidence: `git status --porcelain --untracked-files=all -- packages package.json pnpm-lock.yaml pnpm-workspace.yaml`
was empty before the build. HEAD was `ab42afe` before and after. The only untracked path in the repo is the root
`docs/` folder, which is outside the package. `packages/cli/dist` had 0 tracked files and was the only thing deleted.

Content checks against `git show ab42afe:packages/cli/<file>`: `README.md`, `package.json`, `graphs/optimize.toon`,
`bin/node-assets.cjs` and `LICENSE` match byte for byte.

What changed since `b2835a9`: six behavior-preserving structural commits (`04a1ae7`..`ab42afe`). All commands now
live in `src/commands/`, the tune engine in `src/tune/`, and declarations in `src/types/`. Async functions use the
`Async` suffix, the unused shared-renderer facade was removed, the KTX2 codec setup is shared by the render and
calibration pages, and CLI test files use camelCase names. A code review of `b2835a9..ab42afe` found no issues.

### License and notice files (verified read-only after packing; 16 files, same set as b2835a9 and 22b1827)

| File in tarball | Source | Covers |
|---|---|---|
| `LICENSE` | verbatim copy of the repo root `LICENSE` (Apache-2.0) | core + CLI code; also the Apache-2.0 text for bundled Draco (`draco3dgltf` ships no license file) |
| `dist/core/licenses/babylonpress-ktx2-encoder/LICENSE` | verbatim upstream (MIT) | `dist/core/basis_encoder.wasm` + its loader |
| `dist/core/licenses/@babylonjs/ktx2decoder/{license.md,NOTICE.md}` | verbatim upstream 9.27.1 | KTX2 transcoder wasm in `dist/core` |
| `dist/core/licenses/usd/*.license` | existing USD runtime notices | USD importer |
| `dist/render/licenses/@babylonjs/{core,loaders,ktx2decoder}/*` | upstream | Babylon.js renderer page |
| `dist/render/codecs/{license.md,NOTICE.md,wasm-license.md}` | upstream `@babylonjs/ktx2decoder` | KTX2 codecs in the render page |

No new license or attribution text was written. Every other dependency is installed by npm with its own license, not
bundled.

### Install smoke check (this artifact, 2026-10-26T01:56:23Z–01:56:29Z)

| Field | Value |
|---|---|
| Artifact verified before install | sha256 `8e111cc117d39d5640b7a93539bc46d1ce1e92f80884d543bc6bb14b6bff9b76` (match) |
| Method | `npm install <tarball>` into a disposable temporary project (`npm init -y`). Not global. Deleted afterwards. |
| Environment | macOS, Node v22.20.0, npm 10.9.3 |
| Install | 38 packages added; `node-assets-cli 0.1.0` |
| Startup and help | `--version` → `0.1.0`; `--help` (244 lines) and `help` exit 0; `show optimize` and `show --help` exit 0 |
| Non-render workflow | Khronos Duck (SHA-1 `78170efd55f69ea61bda4ab184ba0776c78c5b5c`): `inspect` exit 0; `run optimize` → 120,484 → 82,852 bytes, exit 0; re-run → `up to date (no-op)`, exit 0 |
| Usage error | `tune` with no input → `code: USAGE`, exit 2 |
| Equivalence | `--help` output, and the `inspect` / `run optimize` / no-op / `tune` usage-error outputs, are byte-identical to the `b2835a9` smoke capture |
| Installed licenses | `LICENSE` matches the repo root byte for byte |
| Not run | anything that renders (`tune`, `run --check`, `inspect --against`) |

Captured output: `transcript-ab42afe/smoke.txt` and `transcript-ab42afe/help.txt`.

### Source-level checks for `ab42afe` (by the refactor, before packing)

These are source checks, not checks of this tarball. Typecheck, ESLint and Prettier pass, and `pnpm build`
succeeds. 214 tests in 19 files pass, including a single run each of the focused browser test files:
`tests/integration/cliRender.test.ts` (small renders, 64–256 px), `tests/e2e/cli.test.ts` (3 tests at 64 px) and
`tests/e2e/cliTune.test.ts` (one tiny tune at 128 px).

A structural comparison against the `b2835a9` tarball found 305 vs 305 packaged paths, with no differences once chunk
hashes are normalized. `--help`, `show optimize` and 17 help/error cases matched its stdout, stderr and exit codes.
This comparison is structural evidence. It is not a render, benchmark or calibration test of this tarball.

### Rendering evidence, scoped to the code it ran on

- **`ab42afe` source:** only the focused browser test files above (tiny synthetic models).
- **Real-model render workflow:** captured once, with the superseded `a9329e2` tarball (`transcript/`: Duck `tune`
  size,gpu, `run --check`, Helmet `inspect --against`). The renderer code has since changed (Async naming, removed
  facade, shared codec setup), and that workflow has not been re-run on this artifact.
- **Not done:** Babylon load-model calibration and re-validation of the 0.9 threshold. See the Scout handoff.

## Superseded (moved, not modified)

| File | sha256 | Source commit | Why superseded |
|---|---|---|---|
| `superseded/node-assets-cli-0.1.0-b2835a9.tgz` | `2602a6d544342a31a83fe65540b5249057176d94f4dd05152b4d4b925980a292` | `b2835a9` (clean build inputs; plain files matched; install smoke passed) | Predates the structural cleanup (`04a1ae7`..`ab42afe`: command modules, `src/tune/`, `src/types/`, Async naming, shared KTX2 codec setup, test names). The packaged JS differs; docs, graphs and licenses are the same. |
| `superseded/node-assets-cli-0.1.0-22b1827.tgz` | `6cb3552b3fbbfd137e2e7437174d4e80d0b269cb2f90be013f47361ed3e47fd5` | `22b1827` (clean build inputs; plain files matched; install smoke passed) | Two doc inaccuracies (ERRORS example, browser discovery) in the README and the bundled man page. `git diff 22b1827..b2835a9`: `packages/cli/README.md`, `packages/cli/docs/node-assets.1.md`. |
| `superseded/node-assets-cli-0.1.0-f64a878.tgz` | `5f2f80655c6d1bbc81a1825d93d8330f7aa16361f0f838f6a92a1e9a1e15a802` | `f64a878` (clean build inputs; plain files matched) | Missing the repo `LICENSE` and the `babylonpress-ktx2-encoder` MIT notice (release blocker). `git diff f64a878..22b1827`: `packages/cli/LICENSE` (new), `packages/core/build/codecBuildPlugin.ts`. |
| `superseded/node-assets-cli-0.1.0-a9329e2.tgz` | `48f48b20b07e107ee54dc23f65cfbe708f6362ddcf4c9da4db5613b3cd1d51d2` | `a9329e2` (committed 12:12:50 -04:00; tarball 12:13:15; clean build inputs; plain files matched) | Docs before the claim qualifications; same license gap. Install/workflow transcript in `transcript/` was captured with this tarball. |

### Evidence recorded for the superseded `b2835a9` artifact

#### Install smoke check (b2835a9 artifact, 2026-10-25T21:33:25Z–21:33:32Z)

| Field | Value |
|---|---|
| Artifact verified before install | sha256 `2602a6d544342a31a83fe65540b5249057176d94f4dd05152b4d4b925980a292` (match) |
| Method | `npm install <tarball>` into a disposable temporary project (`npm init -y`). Not global. Deleted afterwards. |
| Environment | macOS, Node v22.20.0, npm 10.9.3 |
| Install | 38 packages added; `node-assets-cli 0.1.0` |
| Startup and help | `--version` → `0.1.0`; `--help` printed the 244-line manual, including the corrected ERRORS example and the Linux Chromium discovery line; `show optimize` exit 0 |
| Non-render workflow | Khronos Duck (SHA-1 `78170efd55f69ea61bda4ab184ba0776c78c5b5c`): `inspect` exit 0; `run optimize` → 120,484 → 82,852 bytes, exit 0; re-run → `up to date (no-op)`, exit 0 |
| Usage error | `tune` with no input → `code: USAGE`, exit 2 |
| Installed licenses | `LICENSE` matches the repo root byte for byte |
| Not run | anything that renders (`tune`, `run --check`, `inspect --against`) |

Captured output: `transcript-b2835a9/smoke.txt` and `transcript-b2835a9/help.txt`. Skill discovery at `b2835a9`:
`npx skills add <repo> --list` finds `node-assets-cli`, and a local install produces an identical SKILL.md. Release
notes: `release/RELEASE_NOTES.md`.

### Evidence recorded for the superseded `22b1827` artifact

#### Install smoke check (22b1827 artifact, 2026-10-25T20:30:01Z–20:30:25Z)

| Field | Value |
|---|---|
| Artifact verified before install | sha256 `6cb3552b3fbbfd137e2e7437174d4e80d0b269cb2f90be013f47361ed3e47fd5` (match) |
| Method | `npm install <tarball>` into a disposable temporary project (`npm init -y`). Not global. Deleted afterwards. |
| Environment | macOS, Node v22.20.0, npm 10.9.3 |
| Install | 38 packages added; `node_modules/.bin/node-assets` → `node-assets-cli/bin/node-assets.cjs`; `node-assets-cli 0.1.0` |
| Startup and help | `--version` → `0.1.0`; `--help` printed the 242-line manual, including the "numerical SSIM check" wording; `run --help`, home view and `show optimize` exit 0 |
| Non-render workflow | Khronos Duck (SHA-1 `78170efd55f69ea61bda4ab184ba0776c78c5b5c`): `inspect` exit 0; `run optimize duck.glb -o out/duck.glb` → 120,484 → 82,852 bytes, exit 0; re-run → `up to date (no-op)`, exit 0; `inspect out/duck.glb` → WebP + quantized, exit 0 |
| Usage error | `tune` with no input → `code: USAGE`, exit 2 |
| Installed licenses | `LICENSE` matches the repo root byte for byte; 16 license/notice files in the installed package |
| Not run | anything that renders (`tune`, `run --check`, `inspect --against`) |

Captured output: `transcript-22b1827/smoke.txt` and `transcript-22b1827/help.txt`.

#### Documented-commands check (2026-10-25, 22b1827 code)

Run against `packages/cli/dist` built from `22b1827`. Its `dist/cli.js`, `dist/render.js`, `dist/core/index.js`,
`bin/node-assets.cjs` and `graphs/optimize.toon` match the 22b1827 tarball byte for byte. Every command in the README workflow
table and the man page EXAMPLES was run on the Khronos Duck. Rendering commands ran with an invalid
`NODE_ASSETS_CHROMIUM`, so they stop after argument parsing with `NO_BROWSER` (exit 1). That proves the flags are
accepted without launching a browser. 16/16 exited as documented; see `transcript-22b1827/docs-commands.txt`.

Found two documentation inaccuracies, fixed in `b2835a9`:
- The ERRORS example showed `error: unknown goal "speed"`; the real TOON output is `error: "unknown goal \"speed\""`.
- BROWSER and ENVIRONMENT omitted Linux system Chromium and the no-fallback behavior of an invalid
  `NODE_ASSETS_CHROMIUM`.

## Release use

Releasing this existing artifact needs `--target ab42afe1ac1816cc4232b89bc123375c82d3dfbd`, so the tag matches
the tarball's source. Re-check the sha256 above right before uploading.
