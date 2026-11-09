# Scout handoff: validate node-assets CLI v0.1.0 on Babylon.js (load model + fidelity threshold)

Draft for Alex's approval. Nobody has contacted Scout. Results inform Alex's decisions; they do not change defaults or
coefficients by themselves.

Published as a baseline investigation draft on 2026-11-09. The reviewed CLI behavior is still only a proposal;
resolve the current [handoff's](../HANDOFF.md) load/fidelity design questions before authorizing this older plan.
The package remains local; these commands are not permission to run benchmarks.

## Why

The v0.1.0 CLI is a TypeScript port of a research prototype. Two things carried over from the prototype were measured
with its old renderer and have not been checked on Babylon.js:

1. **Load-time estimate** (`load` goal, `load_s` columns): the decode-time coefficients are labeled provisional.
2. **Fidelity default** (`--fidelity 0.9`, worst 64 px SSIM over 4 views at 1024 px): the docs call it a numerical
   check, not a perceptual guarantee.

This run produces the evidence to (A) adopt or reject Babylon-fitted load coefficients, and (B) keep or change the 0.9
default and say whether the port reproduces the prototype's results.

## Rules for the run

- Don't push, publish, tag, release, or commit. Return files only.
- Don't change public defaults or the committed coefficients. Workstream A writes a candidate coefficients file, which
  you return as a diff and then restore.
- Use an idle machine: no other CPU or GPU-heavy jobs during A or B. Never run A and B at the same time.
- One attempt per item; retry once only after an interruption. If anything fails, return the log and stop that item.
- If an asset checksum doesn't match, stop and report. Don't substitute a different model.

## Source

| Field | Value |
|---|---|
| Repo | `alexchuber/Node-Assets` |
| Branch | `cli-redesign-v2` |
| Commit | `ab42afe1ac1816cc4232b89bc123375c82d3dfbd` (available on the fork; keep the investigation pinned to this baseline) |
| CLI tarball, same commit | `node-assets-cli-0.1.0.tgz`, sha256 `8e111cc117d39d5640b7a93539bc46d1ce1e92f80884d543bc6bb14b6bff9b76` (see `release/MANIFEST.md`) |

The calibration tool is dev-only and isn't in the tarball, so Scout needs the checkout. For an offline transfer, Alex
can create a bundle locally and hand over the file:

```sh
# Alex, in the repo:
git bundle create node-assets-ab42afe.bundle cli-redesign-v2
# Scout:
git clone -b cli-redesign-v2 node-assets-ab42afe.bundle node-assets && cd node-assets
git checkout ab42afe1ac1816cc4232b89bc123375c82d3dfbd
```

For an approved run from the fork: `git clone -b cli-redesign-v2 https://github.com/alexchuber/Node-Assets node-assets && git -C node-assets checkout ab42afe1ac1816cc4232b89bc123375c82d3dfbd`.

## Environment

- macOS or Linux, at least 4 CPU cores, at least 8 GB RAM, idle.
- Node 22.20.0 (any of ^20.19 / ^22.13 / ≥24 works). pnpm 11.9.0 (`corepack enable`; the repo pins `packageManager`).
- Google Chrome stable installed, or `NODE_ASSETS_CHROMIUM=/path/to/chrome`. Rendering uses SwiftShader, not the GPU.
- Network access for `pnpm install`, the Khronos downloads, and a one-time download of Babylon.js decoder files
  (workstream A).
- Record in `results/env.txt`: OS and version, CPU model, core count, RAM, `node --version`, `pnpm --version`, the Chrome
  version, `git rev-parse HEAD`.

```sh
pnpm install --frozen-lockfile
pnpm build
mkdir -p results/A results/B1 results/B2
```

## Assets

Khronos glTF-Sample-Assets, glTF-Binary. Check SHA-1 after download (the same files the prototype research used).

| Name | Path under `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/` | SHA-1 |
|---|---|---|
| helmet | `DamagedHelmet/glTF-Binary/DamagedHelmet.glb` | `85c96ef38aea6342df2841f4bfd5a2c496aa4e81` |
| toycar | `ToyCar/glTF-Binary/ToyCar.glb` | `e19747445e1803a1cb508127d466519aabb626c7` |
| lantern | `Lantern/glTF-Binary/Lantern.glb` | `4693ec739a5244a02d6a82959f7ceb31ecdcf85a` |
| boombox | `BoomBox/glTF-Binary/BoomBox.glb` | `3259d2309bdfadbf6bf39b5ec65014c6641f5f3a` |

```sh
mkdir -p assets
K=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models
for p in helmet:DamagedHelmet toycar:ToyCar lantern:Lantern boombox:BoomBox; do
  curl -fsSL -o "assets/${p%%:*}.glb" "$K/${p##*:}/glTF-Binary/${p##*:}.glb"
done
shasum assets/*.glb   # must match the table
```

## A. Load-model calibration (about 15–40 min)

The full procedure is in `packages/cli/docs/calibration.md`. With the assets above:

```sh
pnpm --filter node-assets-cli calibrate:build
node packages/cli/.dev/calibrate.js --out results/A/calib.json --reps 5 --write \
  assets/helmet.glb assets/toycar.glb assets/lantern.glb assets/boombox.glb \
  > results/A/report.toon 2> results/A/progress.log
git diff packages/cli/src/loadModel.coefficients.json > results/A/coefficients.diff
git checkout -- packages/cli/src/loadModel.coefficients.json   # leave the committed coefficients unchanged
```

Return: `calib.json`; `report.toon` (fit summary: n, R², MAE, worst rows, per-model held-out MAE and rank correlation);
`progress.log`; `coefficients.diff`; wall time.

**How it informs the decision.** Alex adopts the new coefficients (and drops the "provisional" label) if R² ≥ 0.90 and
every held-out rank correlation ≥ 0.85. Otherwise the estimate stays provisional, and the report shows which models fit
poorly.

## B. Fidelity threshold and port parity (about 1–1.5 h)

Run the CLI from the checkout: `NA="node $PWD/packages/cli/bin/node-assets.cjs"`. Save each command's stdout (TOON) and
stderr next to its outputs, and record wall time per command.

### B1. Parity with the prototype's research tasks (one model per call)

```sh
$NA tune assets/helmet.glb  --for gpu      --time-limit 9m -o results/B1/G1/ > results/B1/G1.out 2> results/B1/G1.err
$NA tune assets/helmet.glb  --for compat   --time-limit 9m -o results/B1/C1/ > results/B1/C1.out 2> results/B1/C1.err
$NA tune assets/toycar.glb  --for load     --time-limit 9m -o results/B1/L1/ > results/B1/L1.out 2> results/B1/L1.err
$NA tune assets/lantern.glb --for size,gpu --time-limit 9m -o results/B1/M1/ > results/B1/M1.out 2> results/B1/M1.err
# then, for every graph written above (5 graphs), check the saved graph reproduces:
$NA run results/B1/<task>/<model>.<goal>.toon assets/<model>.glb -o results/B1/<task>/<model>.<goal>.glb --check \
  > results/B1/<task>/<model>.<goal>.check.out
```

Prototype references (from `research/cli-v2/harness/ref2.json`, measured with the old renderer and decoder sizes):

| Task | Reference |
|---|---|
| G1 helmet gpu | GPU 7,370,339 B (7.03 MiB), 3,294,776 bytes, KTX2, fidelity 0.94 |
| C1 helmet compat | 1,369,696 bytes, no required extensions, fidelity 0.90 |
| L1 toycar load | load 0.491 s, 309,308 bytes, Draco, fidelity 0.922 |
| M1 lantern size / gpu | size 240,383 B / GPU 3,277,572 B, fidelity 0.901 / 0.911 |

Fidelity values aren't directly comparable (different renderer). Decoder sizes changed slightly with Babylon.js
(Draco 74,865, meshopt 6,694, KTX2 264,668 bytes gzip). The L1 load time depends on the provisional coefficients;
compare bytes and decoders first.

### B2. Threshold ladder (visual evidence for Alex)

```sh
for f in 0.85 0.90 0.93; do
  for m in helmet lantern; do
    $NA tune assets/$m.glb --for size --fidelity $f --time-limit 5m -o results/B2/$m-$f/ \
      > results/B2/$m-$f.out 2> results/B2/$m-$f.err
  done
done
```

Return: every `.toon` graph, every preview `.png` (original | result at the worst view), stdout, and per-run bytes and
fidelity. Bring the 0.90 previews to Alex for review at 100% zoom.

**How it informs the decision.**
- **Parity:** if B1 bytes and GPU are within about ±20% of the references, every search reports `complete`, and every
  `run --check` passes, the README can say the port reproduces the prototype's results on these models (with the
  numbers). Otherwise Alex sees where it diverges before any claim is made.
- **Threshold:** if the 0.90 previews show no visible defects to Alex at 1024 px, keep 0.9 and describe it as
  "spot-checked by eye on helmet and lantern". It is still not a guarantee. If defects show at 0.90 but not at 0.93,
  Alex decides whether to raise the public default.

## Deliverable layout

```text
results/                 (rename to scout-results-ab42afe/ when returning)
  env.txt
  SUMMARY.md             one table per workstream: values vs references, complete/partial, pass/fail, wall time
  A/                     calib.json, report.toon, progress.log, coefficients.diff
  B1/                    <task>.out/.err; <task>/ *.toon, *.png, *.check.out, output .glb sizes
  B2/                    <model>-<f>.out/.err; <model>-<f>/ *.toon, *.png
```

Total machine time is about 1.5–2.5 h.
