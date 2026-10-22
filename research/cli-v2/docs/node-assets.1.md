# node-assets(1) — proposed CLI redesign (MVP)

```text
NODE-ASSETS(1)                     User Commands                    NODE-ASSETS(1)

NAME
     node-assets - make 3D models small and web-ready (.glb)

SYNOPSIS
     node-assets inspect  <file|dir>... [--json]
     node-assets optimize <input>... -o <out.glb|outdir/> [--texture-size PX]
                          [--geometry quantize|meshopt|draco|none]
                          [--max-size SIZE] [-f|--force] [--json]
     node-assets <command> --help
     node-assets --help | --version

DESCRIPTION
     Two commands. inspect tells you what makes a model heavy. optimize
     converts and compresses it into a .glb that a stock web viewer can load.
     Neither command ever prompts, pages, colors output or reads stdin, and
     neither writes anything except the outputs you name (each through a
     temporary file in the same directory).

     Inputs:  .glb .gltf (+ .bin/images) .fbx .obj (+ .mtl/images) .stl
              .usd .usda .usdc .usdz
     Output:  .glb

     A directory argument means the model files directly inside it (not
     recursive). Companion files (.bin .mtl .png .jpg .jpeg .webp .ktx2 .json
     .txt .md) are skipped silently. Any other file found by a directory scan
     is reported as "skip", with the reason, and does not count as a
     failure. An unsupported file named explicitly is a failure.

COMMANDS
  inspect <file|dir>...
     Read-only. For each model: size on disk (including referenced .bin,
     .mtl and image files), texture bytes vs geometry+other bytes, texture
     formats and pixel sizes, mesh/vertex/triangle counts, nodes, materials,
     animations, skins, and any extensions that need a decoder in the viewer.

     One file prints a block. Several files print one row each, largest first,
     followed by the files that could not be read, and a total.

  optimize <input>... -o <out.glb|outdir/>
     With no options, every input goes through the same pipeline:
       1. remove unused and duplicate data;
       2. re-encode textures as WebP, downscaled to fit 2048 px (never
          upscaled; a texture keeps its original encoding if WebP would not
          be smaller);
       3. quantize geometry (KHR_mesh_quantization);
       4. validate the result, then write it atomically.

     The default output needs no decoders. It loads in a stock three.js
     GLTFLoader or Babylon.js glTF loader with no extra setup.
     If validation finds errors, the output is still written and the report
     says whether the input already had them (the usual case: converter
     output) or optimize introduced them.

     Several inputs, or a directory, need -o to be a directory. Each output is
     named <input-basename>.glb. One bad input does not stop the others.

OPTIONS
     -o, --out PATH
            Output .glb, or a directory (required with several inputs).
            Parent directories are created.

     --texture-size PX
            Largest texture width/height in pixels. Default 2048.

     --geometry MODE
            quantize  (default) Needs no decoder.
            draco     Usually the smallest files. The viewer needs a Draco
                      decoder.
            meshopt   Decodes faster than Draco; files are usually larger. The
                      viewer needs a meshopt decoder.
            none      Leave geometry as is. Useful for isolating problems.

     --max-size SIZE
            Size budget for each output, e.g. 500KB, 1.5MB or 2MiB
            (KB/MB = 1000s, KiB/MiB = 1024s). Tries --texture-size, then
            halves it (down to 256 px) until the output fits, and reports the
            size it used. Geometry settings are never changed for you. If the
            budget cannot be met, it fails with BUDGET_UNREACHABLE, writes
            nothing for that input, and reports the smallest size it reached
            and what to try next (e.g. --geometry draco).

     -f, --force
            Replace existing outputs. -o may then be the input itself (in
            place). Files are written to a temporary file and renamed, so a
            failed run never leaves a partial output.

     --json Print one JSON object on stdout instead of text (schema below).

     -h, --help

OUTPUT
     optimize, one input:
        ok assets/helmet.glb -> public/models/helmet.glb
          size      3.60 MiB -> 1.63 MiB (-55%)
          textures  5x JPEG 2048x2048 -> 5x WEBP 2048x2048: 3.06 MiB -> 1.20 MiB
          geometry  quantize, 15,452 tris
          decoders  none needed (loads in stock three.js / Babylon.js glTF loaders)
          valid     yes

     When the output needs a decoder, the decoders line says so, with the
     loader call:
          decoders  draco REQUIRED in the viewer (three.js:
                    loader.setDRACOLoader(dracoLoader); Babylon.js: built in).
                    Omit --geometry for decoder-free output

     With --max-size it adds:
          budget    1MB (1,000,000 bytes) met with textures at 1024px
                    (tried 2048px=1.63 MiB, 1024px=787.8 KiB)

     Validator errors that the input already had are reported as such, and
     the output is still written (error counts are capped at 200):
          valid     no, 200 error(s) inherited from the input

     optimize, several inputs: one line per input, then a summary.
        ok    assets/boombox.glb -> public/models/boombox.glb  10.12 MiB -> 574.9 KiB (-94%)
        FAIL  assets/broken.glb  INVALID_INPUT: assets/broken.glb: not a valid GLB
              file (Invalid typed array length: 40000). Hint: The file is corrupt
              or truncated. Re-export or re-download it; ...
        skip  assets/chair.blend UNSUPPORTED_FORMAT: .blend is not a supported input
              format. Hint: Export it from Blender as .glb (File > Export > glTF
              2.0) or .fbx, then optimize that file.
        summary: 9 ok, 1 failed, 1 skipped; 32.47 MiB -> 9.22 MiB (-72%)
        decoders: none needed (loads in stock three.js / Babylon.js glTF loaders)

     inspect, several inputs:
        FILE                      SIZE  TEXTURES          GEOMETRY+OTHER         TRIS  TEXTURE FORMATS
        assets/boombox.glb   10.12 MiB  9.92 MiB (98%)    204.7 KiB (2%)        6,036  4x PNG 2048x2048
        assets/lantern.glb    9.12 MiB  8.90 MiB (98%)    229.4 KiB (2%)        5,394  4x PNG 2048x2048
        assets/toycar.glb     5.17 MiB  1.67 MiB (32%)    3.50 MiB (68%)      108,936  6x PNG 1024x1024, 2x PNG 512x512
        ...

     --json: optimize prints
        {"ok":bool,"command":"optimize","results":[{"input","output","status":
         "ok"|"failed"|"skipped","bytes_before","bytes_after","textures":{...},
         "geometry":{...},"extensions_required":[...],"decoders_needed":[...],
         "valid":bool,"validation":{"errors","codes","inherited_from_input"},
         "budget":{...},"warnings":[...],"error":{"code","message","hint"}}],
         "summary":{"ok","failed","skipped","bytes_before","bytes_after"}}
     and inspect prints {"ok","command":"inspect","files":[...]} with the same
     fields as the text table. A usage error, or a single input that fails,
     prints only {"ok":false,"error":{"code","message","hint"}}. Sizes are
     always integer bytes.

ERRORS
     In text mode, a single-input error goes to stderr as two lines:
        error[OUTPUT_EXISTS]: public/models/helmet.glb already exists; nothing was written
        hint: Add --force to replace it, or choose another -o path.
     With several inputs, failures are FAIL/skip lines in the stdout report.
     With --json, errors are in the JSON object on stdout.

     USAGE               bad or unknown option/command (exit 2)
     INPUT_NOT_FOUND     no such file or directory
     UNSUPPORTED_FORMAT  not a supported input (the hint says how to export it)
     INVALID_INPUT       corrupt/truncated file, or conversion failed (e.g. an
                         OBJ whose .mtl is missing)
     OUTPUT_EXISTS       target exists and --force was not given
     BUDGET_UNREACHABLE  --max-size cannot be met; smallest possible size given
     OUTPUT_IS_DIRECTORY the output path for an input is an existing directory
     INTERNAL            unexpected failure (a bug); message included

     A failed input never produces an output file.

EXIT STATUS
     0  every input succeeded (files skipped by a directory scan are not
        failures)
     1  at least one input failed; all other outputs were still written
     2  usage error; nothing was read or written

EXAMPLES
     What is heavy, and why?
        node-assets inspect assets/

     Make one model web-ready, replacing the deployed copy:
        node-assets optimize assets/boombox.glb -o public/models/boombox.glb --force

     A whole folder, mixed formats:
        node-assets optimize assets/ -o public/models/ --force

     Stay under a budget:
        node-assets optimize assets/helmet.glb -o public/models/helmet.glb --max-size 1MB --force

     Smallest file, when the viewer has a Draco decoder (Babylon.js loads one by default):
        node-assets optimize assets/toycar.glb -o public/models/toycar.glb --geometry draco --force

     In place:
        node-assets optimize public/models/car.glb -o public/models/car.glb --force

NOTES
     USD input needs Web Worker support (a global Worker). On Node versions
     that have it behind a flag, such as Node 26, run with
     NODE_OPTIONS=--experimental-web-worker. (Carried over from the current
     README; USD was not exercised in these experiments.)

     Two inputs with the same base name (x.glb and x.stl) map to the same
     output; with --force the later one silently replaces the earlier. Known
     gap: should be a USAGE error before anything is written.

     Re-optimizing an already optimized file re-encodes its textures and loses
     quality. Use inspect first: WEBP texture formats, or KHR_mesh_quantization,
     Draco or meshopt under "requires", mean the file was already optimized.

SEE ALSO
     gltf-transform(1), gltfpack(1), three.js GLTFLoader (setDRACOLoader,
     setMeshoptDecoder)
```

---

## Why this design: what was tested

I built each candidate interface as a working CLI over **one shared processing backend**: glTF-Transform, sharp, meshoptimizer, draco3d, plus this repo's Babylon FBX/OBJ/STL/USD converters and glTF validator. Then I measured real agents using them.

**Setup**
- **Agent:** each trial is a fresh, headless Claude Code agent (Haiku 5.5, Sonnet 5.5 or Opus 5.5).
- **Project:** a small three.js product-viewer project containing:
  - real Khronos and three.js sample models (`.glb`, `.fbx`, `.obj` + `.mtl`, `.stl`);
  - a truncated `.glb` and a fake `.blend`;
  - a `viewer.js` with **no decoders configured**.
- **What the agent knows:** one task prompt, and that `node-assets` is on its PATH. Nothing else about the tool.
- **Grading:** from the files on disk: size, validator result, required extensions vs what the viewer configures, textures kept, sources untouched. Report tasks are also graded on the final answer. Every CLI call was logged.
- **Volume:** 362 trials, $9.59 of API usage.
- **Verification:** an independent agent re-checked every number below against the raw trial records, and re-ran the documented build against the claims in the man page.

**Tasks**
- **T1** Make one model web-ready. The viewer lacks decoders, but the prompt doesn't say so.
- **T2** Convert FBX, OBJ and STL.
- **T3** Optimize under an explicit "no decoders" constraint.
- **T4** Fit a 1 MB budget with the best quality possible.
- **T5** Batch-process a folder that contains a corrupt file and a `.blend`.
- **T6** Read-only diagnosis: which models are largest, and is it textures or geometry?

**Held-out tasks**, written before the ablation results came in:
- **H1** Smallest possible file, all decoders allowed.
- **H2** Optimize only the files that aren't optimized yet, in place.
- **H4** Every model under 500 KB; the viewer may be updated.

### 1. Both the new capabilities and the new interface matter

Same six tasks, Haiku + Sonnet, 3 reps each:

| interface | verified success | turns | CLI calls | failed calls | own scripts written | input tokens | median time |
|---|---|---|---|---|---|---|---|
| current: `pipeline <in> [ops] <out>` | 17/36 (47%) | 11.8 | 10.8 | 2.2 | 1.9 | 199k | 122 s |
| op list with the **same backend as the proposal** | 28/36 (78%) | 7.3 | 8.6 | 1.7 | 1.4 | 90k | 67 s |
| proposed: `inspect` / `optimize` | **72/72 (100%)** | 5.0 | 5.8 | 0.6 | ~0 | 50k | 33 s |

The middle row separates the two effects:

- **Current → op list (31 of the 53 points).** This step adds the capabilities the current CLI lacks: WebP, texture resize, and quiet validation and converter output.
- **Op list → proposed (the other 22 points).** This step changes only the interface. It also cuts turns by about a third and tokens by about 45% compared with the op list.

The op list's failures are interface failures:

- **Too few ops chosen.** One agent skipped WebP and resizing *"because they add a compression extension that some loaders need extra setup for"*. That's false for stock three.js, and resizing adds no extension at all. A batch run that chose only geometry ops shipped files at 83% of the original size.
- **A usable model withheld.** Agents got *"Validation failed with 18 errors"* with no codes. They couldn't tell that the errors were already in the artist's FBX, so they held back a usable model.

With the current CLI, agents fell back to writing their own sharp/PIL resize scripts and digging through the library's source. CLI output averaged 288k characters per trial. Most of it came from `validate` printing every issue: one FBX produces 2,041 near-identical errors, about 5,100 lines. In stage 1, 28 current-CLI calls ran longer than 120 s, which is when Claude Code stops waiting and pushes a command to the background. Every one was a `ktx2` encode.

### 2. The default must not need decoders

I ran the same tasks with two defaults: meshopt and quantize.

- **With meshopt as the default**, 11 of 18 runs on tasks that didn't mention the viewer shipped files that the project's viewer can't load.
- **With quantize as the default**, that number was 0 of 18. Success and cost were identical.

The effect depends on the model:

- **Haiku** usually checked the viewer on its own and switched to quantize (7/9). One explained it chose quantize *"because `src/viewer.js` uses a plain `GLTFLoader` with no meshopt or Draco decoder"*.
- **Sonnet** shipped the meshopt default 9/9 times.

A safe default protects every agent; a warning line protects only some. The compression gap is real on geometry-heavy models: ToyCar is 2.84 MiB quantized vs 0.60 MiB with Draco. So `--geometry draco` is a one-flag opt-in, and the report states what the viewer then needs. This matches a rule in a [published GLB-export agent skill](https://www.typingmind.com/skills/pascalorg-glb-web-export): "Never ship a file with `EXT_meshopt_compression`, `KHR_draco_mesh_compression`, or `KHR_texture_basisu` unless the loader is confirmed to decode it."

### 3. Feature ablations: remove one feature, keep everything else

Same tasks, Haiku + Sonnet, 3 reps (n=12–24 per arm). Wall time isn't used for these decisions: the ablation arms ran in a separate batch, alongside slow `ktx2` trials, and every arm was slower than the base (median 40 s vs 33 s).

| feature removed | success | measured effect | decision |
|---|---|---|---|
| text output (JSON made the default) | 18/18 → **15/18** | Haiku saw `"valid": false` for validator errors the input already had, and deleted a good output. That happened in 3/6 runs with JSON as the default vs 0/48 with text. Also +17% tokens. | Text by default, `--json` opt-in. Agents opted in on their own in 32% of trials (52/162). |
| batch inputs | 12/12 → 12/12 | CLI calls 6.2 → 11.9 per trial | keep |
| `inspect` | 18/18 → 18/18 | Haiku +22% tokens and +0.8 turns (n=9): agents wrote their own GLB parsers. Sonnet unchanged. | keep (used in 98% of trials where it existed) |
| `--max-size` | 6/6 → 6/6 | CLI calls 8.2 → 10.0. Sonnet +37% tokens and +1.7 turns; Haiku −12% tokens (n=3 per model). | keep, but the evidence is thin; cut it first |
| result summary | 24/24 → 24/24 | +3% tokens; CLI calls 6.1 → 6.8 | keep: it *is* the result, and it carries the decoder, budget and validity lines |
| recovery hints in errors | 18/18 → 18/18 | tokens and turns unchanged; CLI calls 6.2 → 7.0 | keep error codes; hints only where recovery isn't obvious |
| "next step" hints in `inspect` | 12/12 → 12/12 | tokens +4%, turns +0.2 | **cut** |

### 4. Held-out tasks, a third model, and the exact build on this page

- **Held-out tasks (H1, H2, H4)**, final design vs op list with the same backend, Haiku + Sonnet + Opus, 3 reps:
  - success **27/27 vs 25/27**
  - 6.6 vs 10.5 turns
  - 73k vs 161k tokens
  - median time 47 s vs 174 s

  Both op-list failures were on H1 and left the file over 1 MB: one agent stopped at meshopt, the other used Draco but kept the PNG textures.
- **Opus on T1–T6** with the final design: 18/18.
- **The exact build this page documents** (`ktx2` and inspect hints removed), on all nine tasks (Haiku + Sonnet, 2 reps): **36/36**, 5.3 turns, 58k tokens.

### Cut from the MVP

- **`ktx2`.** In these tests it never helped download size. On the helmet it made the file 3× larger (3.6 → 10.3 MiB), because normal maps go to UASTC. It's also slow: about 140 s for a model with 2K textures, on 2 cores. In H1 ("as small as you can, any decoder OK") it was a time sink:
  - with the op list, agents tried it in 9 of 9 runs;
  - with the final design, in 6 of 9 runs;
  - none of them shipped KTX2.

  Removing it produced the identical file in every run. Median time was 58 s with `ktx2` offered vs 33 s without (n=6 vs n=4, different batches, so treat this as indicative). `EncodeKTX2Block` can stay in the library for GPU-memory use cases.
- **`--textures keep|webp`:** in the six original tasks, agents only used it to restate the WebP default, plus one `keep`. In H1 it was used to explore `ktx2`, as above.
- **`--stats` and `--benchmark`:** every result already shows sizes.
- **The op-list command, and `validate`/`cull-unused`/`dedup`/`strip-materials` as separate ops:** folded into `optimize`, or never used.
- **Progress/ETA lines:** a probe showed the agent sees no output until the command ends, or until it is moved to the background at 120 s.
- **Dry-run/plan:** outputs are new files written atomically, and nothing is overwritten without `--force`.

### Small fixes that came out of the transcripts

- Report validator error codes, and whether the input already had them.
- Echo budgets in the caller's units ("1MB (1,000,000 bytes)").
- Suggest `--geometry draco` when meshopt can't meet a budget.
- Never make a texture bigger: Fox's 26 KiB PNG became a 33 KiB WebP.
- Warn when the output is larger than the input (an STL went 49 → 54 KiB).

Every agent's first call was `--help` (362 of 362 trials). The help text, with its examples, is the documentation that actually gets read.

### Caveats

- Only Claude models, in one agent harness.
- I wrote the tasks myself. The held-out tasks reduce that bias but don't remove it.
- Cells range from n=3 (per-model ablation figures) to n=72. Ablation effects under ~20%, and anything quoted from n=3–4, are indicative only.
- Graded by static checks (validator, extensions vs viewer code), not by rendering in a browser or judging visual quality.
- Babylon.js compatibility of the default output is from its loader source (9.27 ships `KHR_mesh_quantization` and `EXT_texture_webp` handlers), not from rendering.
- Wall-clock times are noisy: concurrent trials shared 2 CPUs.

### What it takes to build this in the repo

- **New core block: textures to WebP with a pixel cap.** It can build on the existing `RasterImageCodecResource` (it already has `resizeAsync`). Keep the original encoding when WebP isn't smaller.
- **New core block: dedup.** `CullUnused` (prune), `Quantize`, `EncodeDraco` and `EncodeMeshopt` already exist and are reused as they are.
- **`ValidateBlock` should return data instead of logging.** Today it runs with `maxIssues: 0` (unlimited) and `console.log`s every issue, which is where most of that 288k characters of output came from. It should return error codes and counts, so `optimize` can compare them with the input and say whether the errors were inherited. Babylon's converter logs need the same treatment: keep them off stdout.
- **A small stats helper** (texture bytes vs the rest, counts, required extensions), shared by `inspect` and the `optimize` report.
- **The CLI itself:** two commands, a fixed default pipeline, a budget loop over texture size, and text or JSON rendering of one result object. The tested prototype is a single ~850-line file in the experiment kit (`proto/impl3.mjs`), and that count still includes the experiment's variant switches.
