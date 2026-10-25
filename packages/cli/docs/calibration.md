# Calibrating Babylon.js cold-load estimates

This is maintainer tooling, not a `node-assets` command. Its source (`dev/`),
build (`.dev/`) and cache (`.cache/`) are excluded from the npm package. Run
commands from the repository root, with dependencies and the core build present.

## Build and run

```sh
pnpm --filter node-assets-cli build
pnpm --filter node-assets-cli calibrate:build
mkdir -p packages/cli/.cache/models
for model in DamagedHelmet ToyCar Lantern BoomBox; do
    curl --fail --location --retry 3 \
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/$model/glTF-Binary/$model.glb" \
        --output "packages/cli/.cache/models/$model.glb"
done
node packages/cli/.dev/calibrate.js \
    --out packages/cli/.cache/calib.json --reps 5 --write \
    packages/cli/.cache/models/DamagedHelmet.glb \
    packages/cli/.cache/models/ToyCar.glb \
    packages/cli/.cache/models/Lantern.glb \
    packages/cli/.cache/models/BoomBox.glb
pnpm --filter node-assets-cli build
```

If the core distribution is missing, first run `pnpm build:core`. The full run
builds 16 variants per model and measures 320 cold loads. Allow roughly 15–40
minutes on an idle machine; CPU, texture encoding, browser and decoder startup
can change that considerably. This is an estimate, not a measured runtime.

`--out FILE` is required. `--reps` defaults to 5; `--variants N` limits variants
per model. Without `--write`, only the report is written. `--write` requires all
16 variants and at least two models; use four representative models, inspect the
fit and held-out rankings, and review the JSON diff before keeping it. Rebuild
the CLI after writing coefficients: they are bundled, not read at runtime.
Unknown options fail with exit 2; runtime failures exit 1. Nothing prompts.
Stdout contains TOON; progress and diagnostic messages go to stderr.

For a single tiny smoke check, without updating coefficients:

```sh
curl --fail --location --retry 3 \
    https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb \
    --output packages/cli/.cache/models/Duck.glb
node packages/cli/.dev/calibrate.js --out packages/cli/.cache/smoke.json \
    --variants 3 --reps 1 packages/cli/.cache/models/Duck.glb
```

## What is measured

The tool executes core graphs through the CLI's `executeGraph`. Texture
variants use keep/WebP/AVIF/KTX2 at 1024 and 256 px, PNG at 512 px and JPEG at
2048 px with quantized geometry. Geometry variants use quantize/meshopt/Draco/
none with WebP at 256 px. Two extra variants combine AVIF at 1024 px with
meshopt/Draco. The first three exercise KTX2, meshopt and Draco so the smoke
check reaches every decoder family.

The core's normal encoding contracts apply: images are never upscaled, mixed
color/data textures are skipped, and larger raster encodes may be discarded.
Features are extracted from the resulting GLB document and byte count, not
inferred from requested settings. Decoder extensions stay compressed in the
bytes served to Babylon.js.

Compressed source geometry is decoded and its Draco/meshopt extensions removed
before each variant graph runs. Only that variant's selected geometry encoder
can reintroduce compression; quantize/none never inherit the source codec.

Before measurement, the tool GETs Babylon.js's CDN builds of
`draco_wasm_wrapper_gltf.js`, `draco_decoder_gltf.wasm`,
`draco_decoder_gltf.js` and `meshopt_decoder.js` into
`packages/cli/.cache/babylon-decoders/`. Existing files are reused; remove that
directory explicitly to refresh them. The report records their URLs and
SHA-256 hashes because the CDN URLs are not version-pinned. KTX2 uses the
already-built local files in `dist/render/codecs/`.

A server binds only to `127.0.0.1`. Every measurement opens a **fresh browser
context**, loads the Babylon.js page, and measures from `AppendSceneAsync`
through `scene.whenReadyAsync()`. The 64 px canvas and engine are initialized
before timing; decoder fetch, compilation, image decode, texture upload and
scene readiness are inside timing. No GLB is decompressed on the server.
Browser requests outside the local origin are blocked, and response caching is
disabled. Draco and KTX2 decode on the main thread; meshopt uses Babylon.js's
worker behavior. Rendering uses SwiftShader, matching the CLI fidelity
renderer. Browser profiles and scratch files stay under the ignored cache
and are removed when the loader stops.

This defines a reproducible _context-cold_, local-server load, not a browser
process restart, network download benchmark, or hardware-GPU device forecast.
Babylon.js page/bootstrap time is excluded. Fresh contexts do not guarantee a
process-wide or OS-wide cold cache. Use an idle machine and the same browser
when comparing calibrations.

## Fit and report

`src/loadModel.coefficients.json` contains `coefficients`, `source` and `fitted`
(`{ n, r2, maeMs }`, or `null` for provisional values). The checked-in provisional
numbers preserve the existing deterministic load estimate.

The TypeScript fitter uses Lawson–Hanson nonnegative least squares with scaled
columns and pivoted QR. The features are a constant, decoder presence, geometry
megabytes by codec and texture megapixels by format. The JSON report includes
all raw repetitions, their median and range, actual features, requested
variants, fetched decoder names, coefficients, R², MAE, leave-one-model-out MAE
and Spearman rank correlation, and the five largest absolute residuals.
Undefined R²/correlations are `null`; missing features and underdetermined
smoke fits produce warnings. No Python or additional dependency is needed.

`--write` stamps the Babylon.js version, browser version, date and fit statistics
alongside the coefficients. A good in-sample fit alone is insufficient: examine
held-out model rankings, missing feature warnings, outliers and measurement
spreads. The single-model smoke check is deliberately too small to calibrate.
