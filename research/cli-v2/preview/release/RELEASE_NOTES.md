# node-assets CLI v0.1.0 (preview)

`node-assets` makes 3D models small and web-ready. Pick a goal (download size, GPU memory, load time or
compatibility), and `tune` searches the optimization settings for the best result within a fidelity limit. Each
candidate is rendered with Babylon.js next to the original and must score 0.9 or higher (worst-region SSIM at
1024 px by default). The winning settings are saved as a small graph file that `run` applies to other models.

> Preview. The fidelity limit is a numerical check, not a validated guarantee that differences are invisible.
> Not published to npm.

## Install

Requires Node.js 20.19+, 22.13+ or 24+. Rendering commands (`tune`, `run --check`, `inspect --against`) need Google
Chrome, Microsoft Edge or Chromium (`npx playwright install chromium` if none is installed).

```sh
npm i -g https://github.com/alexchuber/Node-Assets/releases/download/cli-v0.1.0/node-assets-cli-0.1.0.tgz
node-assets --version
```

Agent skill (thin wrapper that points agents at `node-assets help`):

```sh
npx skills add https://github.com/alexchuber/Node-Assets/tree/cli-v0.1.0/skills/node-assets-cli
```

## Quick start

```sh
node-assets tune model.glb --for size -o graphs/
node-assets run graphs/model.size.toon model.glb -o public/model.glb
node-assets run optimize model.glb -o public/model.glb   # built-in graph, no rendering
```

`node-assets help` prints the full manual. The README lists every workflow.

## What was verified

- **This release asset:** installed into a fresh local project on macOS (Node 22.20). Version, help and `show`
  start up, and `inspect`, `run optimize` and its no-op re-run work. Their output is identical to the previous
  preview build. No rendering was run on this exact asset.
- **This release's source:** typecheck, lint and 214 automated tests pass. They include the renderer's focused tests
  on small synthetic models and one tiny `tune` run.
- **Earlier builds (before a behavior-preserving code reorganization):** a real-model workflow ran on the Khronos
  Duck. `tune` for size and GPU memory finished in 27 s, 120 KB → 23 KB at fidelity 0.929, and `run --check`
  passed. Every documented command was also checked to parse. Neither has been re-run on this release.
- **Prototype research (historical):** agents using the research prototype's `tune` landed at a median 1.09× the
  best known result, versus 2.11× setting options by hand. That prototype used a different renderer, and this
  Babylon.js port hasn't been re-graded yet.

## Known limits

- The 0.9 fidelity default hasn't been re-validated on the Babylon.js renderer. Check the preview images.
- The `load` goal's decode-time coefficients are provisional.
- Tested on macOS. Windows and Linux paths are covered by unit tests only.
- Fidelity uses the static pose; animated and skinned models aren't posed.
- `size` counts raw bytes, not gzip or brotli transfer size.
- USD input needs Web Worker support (`NODE_OPTIONS=--experimental-web-worker` where available).

## Asset

`node-assets-cli-0.1.0.tgz`, sha256 `8e111cc117d39d5640b7a93539bc46d1ce1e92f80884d543bc6bb14b6bff9b76`, built from
commit `ab42afe1ac1816cc4232b89bc123375c82d3dfbd`.
