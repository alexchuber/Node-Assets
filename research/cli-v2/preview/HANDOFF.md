# Continue the Node Assets CLI preview

The CLI preview is implemented and packaged at `ab42afe`. Alex's 17 later comments are incorporated into the
interactive guide, but have not been implemented in the CLI.

This handoff and guide are published on `alexchuber/Node-Assets`, branch `cli-redesign-v2`. `BabylonJS/Node-Assets`
is the upstream repository. This documentation publication does not release the CLI or authorize its proposed
behavior changes.

## Start on another machine

Clone the fork's branch into a new directory:

```sh
git clone -b cli-redesign-v2 https://github.com/alexchuber/Node-Assets.git
cd Node-Assets
git status --short
```

Open that checkout in a fresh agent session using GPT-6.1 Sol. Use the branch tip to get these handoffs; do not
check out `ab42afe` unless you specifically need the old package's source without the added documentation.

Paste this kickoff:

> Continue my Node Assets CLI preview work. Read `research/cli-v2/preview/HANDOFF.md` and the interactive guide in
> `research/cli-v2/preview/guide/`. The guide incorporates 17 comments as proposed behavior; those changes are not
> implemented in the CLI. Resume the guide review with me, carry the comments through all affected sections, and
> resolve the remaining design questions. Get approval on a bounded code plan before implementing. Use GPT-6.1 Sol
> and focused checks only. No release, Scout contact, or global configuration changes. Ask before further publication.

## Open the review guide

```sh
cd research/cli-v2/preview/guide
npx -y lavish-axi node-assets-cli-guide.html
```

Use the URL printed on the new machine; a localhost URL from the old machine does not transfer. The eight
`parts/*.html` files are the editable sources. From the repository root, rebuild the assembled HTML with:

```sh
node research/cli-v2/preview/guide/build-guide.mjs
```

From the guide directory, the new agent listens for comments with:

```sh
npx -y lavish-axi poll node-assets-cli-guide.html
```

Use a foreground poll or a tracked background tool that notifies the same agent on completion. Do not use `nohup`,
shell `&`, or an unmonitored detached poll. No global hook/plugin setup is needed. Do not use Lavish `share`.

All 17 delivered comments are incorporated or recorded inline. The raw review history is in the local transfer
archive, not this public repository. There were zero server-pending comments when the transfer was prepared.
Any additional unsent annotations belong to the old browser tab and must be copied or submitted separately.

## Implementation and artifact

| Item | Value |
|---|---|
| Package | `node-assets-cli` 0.1.0; executable `node-assets` |
| Package source | `ab42afe1ac1816cc4232b89bc123375c82d3dfbd` |
| Source comparison/base | `main` at `0561ad6d454b854c866e70d67aeebb403fb7ba9f` |
| Latest cleanup | Six behavior-preserving commits in `b2835a9..ab42afe` |
| Current tarball | `node-assets-cli-0.1.0.tgz`, retained locally; no release upload in this publication |
| SHA-256 | `8e111cc117d39d5640b7a93539bc46d1ce1e92f80884d543bc6bb14b6bff9b76`, rechecked 2026-11-09 |
| Working state before these docs | No tracked changes; only Alex's untracked generated `docs/` |

The TypeScript CLI bundles core and uses Babylon-only rendering. It includes README/manual, a built-in optimize
graph, a thin agent skill, and license notices. Commands live under `packages/cli/src/commands/`; search under
`src/tune/`; rendering under `src/render/`; declarations under `src/types/`.

Read [release/MANIFEST.md](release/MANIFEST.md) for the baseline evidence. The exact tarball passed a disposable
non-render install smoke on macOS. Source checks included 214 focused tests and tiny synthetic browser tests.
The recorded real-model rendering workflow used the older `a9329e2` tarball, not the current package. The historical
1.09x versus 2.11x result is prototype research, not a grading of this Babylon implementation. Load coefficients and
the numerical 0.9 SSIM threshold still need validation. Do not carry old evidence forward as if newly run.

The documentation-only commits adding this handoff do not change packaged content. No new package build is implied.

## Requests captured in the guide

- Drop `compat`; defer a possible browser-support threshold/filter.
- Remove provenance hashes from GLB extras.
- Keep limits temporary to `tune`; remove saved graph limits and `run --check`.
- Use `--help`, including missing/unknown-command help fallback; remove current-folder discovery.
- Rename `--against` to `--compare`, preserving comparison usage.
- Use a comma-separated `--include load-time` opt-in for optional load-time reporting.
- Propose `--network-throttling` with `none`, `fast-4g`, `slow-4g`, and `3g`; default `none`.
- Remove `--amortize` and cross-model codec-cost calculations; explain sharing/caching in a note.
- Rename `--time-limit` to `--timeout`, accepting numeric seconds. The guide retains the default as 420 seconds;
  60 is an example, not a changed default.
- Do not require trailing slashes for output directories. Baseline tune already accepts paths without them.
- Keep the 4-bytes-per-pixel GPU estimate as an approximation; record the requested source TODO when implementing.

None of these source changes is complete, including the simple flag renames and TODO. The most recent completed
assignment was the guide update, not implementation.

## Decisions still open

| Question | What not to assume |
|---|---|
| `disk-size`, `download-size`, `load-speed` goal split? | Alex asked a question, not a final naming decision. |
| `--view` naming and 4096 default? | This flag controls rendered comparison image size, not maximum texture size. Baseline default is 1024. |
| `--min-pixel-diff-ratio`? | The implemented metric is worst-region SSIM, not a pixel-difference ratio. |
| Measured load time and throttle rates? | Current load time is a CPU-side provisional estimate, already browser-free. Actual measurements are new behavior; `none` has no finite rate in the old formula. |
| No-op/overwrite after removing provenance? | Current safe no-op depends on output hashes. Do not silently replace it with sidecars. |
| Missing/unsupported positional paths and help exit status? | An argument like `foo` may be a file path. Do not turn every real file failure into successful help. |
| Older graphs with saved limits? | Migration behavior has not been chosen. |

The guide marks these points inline. Read the repository's `AGENTS.md`, `CONTRIBUTING.md`, and the baseline CLI
README/manual before implementing. Keep public defaults and substantive design choices with Alex.

## Rules for continued work

- Use GPT-6.1 Sol (`gpt-6.1-sol`), preferably high or xhigh reasoning; no Claude or Auto routing.
- Prefer functional patterns, consistent names, and predictable file placement. Keep the TypeScript/core-graph/
  Babylon-only design and the existing optimize preset.
- Preserve user changes and generated `docs/`. Do not stash, reset, or change branches on your own initiative.
- Run focused tests only. No full suites, no large batches of render runs. If something needs a heavy run, give Alex
  the exact command instead. No broad render/calibration benchmarks are authorized.
- Preserve older artifacts before any approved rebuild/repack. Tie the new manifest and disposable-install smoke
  to the new artifact's commit and SHA-256.
- Keep CLI help, README, manual, skill workflow, and guide consistent when source changes are approved.
- No further push, publication, release, protected customization writes, or Scout contact without approval.
  Earlier research-link/release decisions remain with Alex; the Scout handoff is a draft, not permission to run it.
