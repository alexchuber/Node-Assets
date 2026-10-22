# node-assets(1), v2: goal-tuned recipes

The design is the one you described:
- Pick a goal (size, GPU memory, load speed or compatibility).
- `tune` pulls every applicable lever as far as it will go without crossing a fidelity limit, checked by rendering the
  model.
- `tune` writes the winning settings as a small TOON recipe, which `run` applies to any number of models.
- Decoder downloads count toward size and load, shared across the assets that use them.

It was built as a prototype (v0.7) and tested against headless Claude agents in three rounds.

| | Agents with `tune` | Agents without it (every lever available as a flag) |
|---|---|---|
| Result vs best known (median, round 2) | **1.09×** | 2.11× |
| Near the best, all checks pass | 11/20 | 4/20 |
| Passed the separate quality check (≥ 0.895) | 100% | 100% |

Each round found real defects, and 7 fixes went in, each tied to what the runs showed. They are listed under Evidence,
with the open questions at the end.


```text
NODE-ASSETS(1)                     User Commands                    NODE-ASSETS(1)

NAME
     node-assets - make 3D models small and web-ready, tuned for a goal

SYNOPSIS
     node-assets
     node-assets inspect  <file|dir>... [--against <original|dir>] [--view PX]
                          [--network NET]
     node-assets tune     <input>... --for GOAL[,GOAL...] [-o DIR] [--fidelity F]
                          [--view PX] [--network NET] [--amortize N]
                          [--keep hierarchy,texture-size,geometry] [--time-limit DUR]
     node-assets run      <recipe> <input>... -o <out.glb|dir/> [--check] [--force]
     node-assets optimize <input>... -o <out.glb|dir/> [lever flags] [--force]
     node-assets setup    [--hook] [--skill]
     node-assets <command> --help
     node-assets --version

DESCRIPTION
     tune searches the optimization levers for the best result for a goal and
     writes the winning settings as a recipe: a small, editable TOON file. run
     applies a recipe to any number of models. A recipe tuned on one model can be
     re-checked on others, edited by hand, or have stages from different recipes
     swapped in.

     Every result must stay within a fidelity limit. The original and the
     candidate are rendered from the same 4 views; a candidate passes only if its
     worst 64 px region still scores the limit or higher (SSIM, 1 = identical;
     default 0.9 at 1024 px). The limit holds at the render size, so set --view
     to the largest size the model will appear on screen: 2048 for a zoomable
     product viewer or VR close-ups.

     Output is TOON on stdout (https://toonformat.dev); progress goes to stderr.
     Nothing prompts. Errors are TOON on stdout too, with a code and a fix.
     Inputs: .glb .gltf .fbx .obj(+.mtl) .stl .usd(a|c|z). Output: .glb.

GOALS (tune --for)
     size     Smallest download: file bytes (no HTTP compression assumed) plus
              the decoders the file needs (gzip: meshopt 6 KB, Draco 75 KB, KTX2
              transcoder 260 KB). Decoder bytes are split across --amortize N
              assets (default: the number of inputs), because a visitor
              downloads each decoder only once.
     gpu      Lowest GPU memory (estimate). Textures: 4 B/px decoded (PNG, JPEG,
              WebP, AVIF) or 1 B/px (KTX2 transcoded to ASTC/BC7), plus 1/3 for
              mipmaps. Vertex data: stored component sizes, except that Draco
              decodes to float32.
     load     Fastest first display: download time on --network (slow-4g
              1.6 Mbps, 4g 9 Mbps default, wifi 30 Mbps), decoders included,
              plus parse/decode time estimated from the file's contents
              (decoder start-up, geometry bytes per codec, image megapixels per
              format). The estimate comes from a model fitted to cold loads in
              headless Chromium; it is deterministic, so the same input always
              ranks the same way, even on a busy machine.
     compat   Loads in any glTF 2.0 viewer: fewest required extensions (no
              decoders, no WebP/AVIF/KTX2, no quantization), then smallest.

     Several goals in one run share the encode/render work and write one recipe
     per goal. Ties (goal metric within 1%) go to higher fidelity, then to
     smaller files.

LEVERS
     Always on, lossless: remove unused data, merge duplicate meshes, textures
     and materials, merge identical vertices, convert spec/gloss materials to
     metal/rough. tune also flattens the hierarchy (models without animation)
     and instances repeated meshes, unless --keep hierarchy is given.
     Searched, all within the fidelity limit:
       texture format   AVIF, WebP (size, load); KTX2 ETC1S, UASTC, or ETC1S
                        color + UASTC data maps (gpu); JPEG, PNG (compat)
       texture size     256, 512, 768, 1024, 1536, 2048, 3072, 4096 px, up to
                        the original, by bisection
       texture quality  30-90, for color maps and for data maps (normal,
                        metal/rough, occlusion) separately
       geometry         quantize; meshopt (medium/high); Draco at 14/10/12 or
                        11/8/10 bits; none (compat)
       simplification   keep 75%, 50% or 25% of triangles (models above 2k
                        triangles, unless --keep geometry)
     Not implemented: texture atlasing, KTX2 RDO, gzip/brotli-aware sizing.

SEARCH
     Work runs in rounds, most promising first, so a run cut short still has a
     good answer for every goal:
       1  each goal's first-choice geometry modes, and its first-choice
          texture format at full size; the best predicted texture + geometry
          combinations are built and scored; then the smallest texture size
          within the limit (KTX2: bisection over sizes from the start)
       2  texture quality (both map types together, then each alone); lossier
          Draco; simplification; combinations again
       3  other texture formats; combinations again
     Texture and geometry settings are scored separately (their bytes add up);
     a combination that falls below the limit rules out any combination that
     is lossier in both stages. A run stopped by --time-limit marks its rows
     "search: partial" and its warning lists what was not tried and the command
     that finishes the search.

COMMANDS
  (no arguments)
     Home view: the executable, what the tool does, the models and recipes
     under the current directory (largest first), and next steps.

  inspect <file|dir>...
     Bytes, estimated GPU memory, estimated load time on --network, triangles,
     textures, decoders, required extensions. Several files: one row each,
     largest first.
     --against ORIGINAL  renders each file and the original; adds fidelity,
                         load_s (with its breakdown) and the original's numbers
     --against DIR       compares each file with the file of the same name in DIR

  tune <input>... --for GOAL[,GOAL...]
     Writes into -o DIR (default .), for each input and goal:
       <name>.<goal>.recipe.toon    the winning settings, with provenance
       <name>.<goal>.preview.png    original | result, at the worst view
       <name>.tune.toon             every candidate tried, with its numbers
     Prints, per input and goal: bytes, decoder bytes, GPU MiB, load seconds,
     fidelity, the chosen textures and geometry, the decoders needed, whether
     the search completed, and the preview path. tune does not write models;
     use run. The originals' bytes, GPU memory and load time are printed too.
     --fidelity F    limit, 0-1 (default 0.9)
     --view PX       render size for the fidelity check (default 1024)
     --keep ...      hierarchy (no flatten/instancing), texture-size (no
                     downscaling), geometry (no simplification)
     --time-limit D  total budget for the whole run, e.g. 90s, 5m (default 7m).
                     Agent shells often stop commands after about 10 minutes;
                     tune one model per call when a batch needs longer.

  run <recipe> <input>... -o <out.glb|dir/>
     Applies a recipe (TOON or JSON). Several inputs or a directory need
     -o dir/. Each output records which recipe and input produced it, so running
     the same command again is a no-op ("up to date", exit 0). Any other
     existing file needs --force.
     --check  renders each output against its input and fails (exit 1) any that
              fall below the recipe's limit. Use it before reusing a recipe on
              other models.

  optimize <input>... -o <out.glb|dir/>
     Runs the default recipe (WebP <= 2048 px, color q90, data maps q95,
     quantized geometry, lossless cleanup) with any lever overridden by a flag:
     --texture-format, --texture-quality, --texture-data-quality,
     --texture-size, --ktx2, --geometry, --draco-bits, --simplify,
     --meshopt-level, --keep-hierarchy. optimize does not check fidelity; use
     inspect --against.

  setup [--hook] [--skill]
     Opt-in integration for the current project. --hook adds a Claude Code
     SessionStart hook (.claude/settings.json) that puts the home view in
     front of the agent at the start of every session. --skill writes
     .claude/skills/node-assets/SKILL.md from the same text. Re-running is a
     no-op; a moved executable path is repaired.

RECIPES
     A recipe has three stages, cleanup, textures and geometry, plus check
     (the limit) and tuned (provenance). textures.quality applies to color
     maps, textures.dataQuality to normal, metal/rough and occlusion maps.
     Omitted fields take the default recipe's values. Unknown keys and
     out-of-range values are errors that name the valid keys or range. To mix
     goals, copy one stage from another recipe; stage bytes add up, so the
     size of a mix is predictable. Check the look of a mix with run --check.

        recipe: 1
        name: helmet.size
        goal: size
        stages:
          cleanup:
            prune: true
            dedup: true
            weld: true
            ...
          textures:
            format: avif
            quality: 60
            dataQuality: 60
            maxSize: 2048
            ...
          geometry:
            mode: draco
            dracoPosition: 14
            ...
        check:
          fidelity: 0.9
          view: 1024
          views: 4
        tuned:
          input: assets/helmet.glb
          result:
            bytes: 545868
            decoders: draco
            gpu_mib: 107.2
            load_s: 0.83
            fidelity: 0.901

OUTPUT (tune assets/helmet.glb --for size,gpu,load -o recipes)
     limits:
       fidelity: ">= 0.9 (worst 64px-region SSIM vs original, 4 views at 1024px)"
       network: 4g (9 Mbps)
       decoders_amortized_over: 1 asset(s)
     originals[1]{input,bytes,gpu_mib,load_s}:
       assets/helmet.glb,3773916,107.2,3.57
     results[3]{input,goal,recipe,bytes,decoder_bytes,gpu_mib,load_s,fidelity,textures,geometry,decoders,search,preview}:
       assets/helmet.glb,size,recipes/helmet.size.recipe.toon,545868,74764,107.2,0.83,0.901,avif q60/60 (color/data maps) <=2048px,draco,draco,complete,recipes/helmet.size.preview.png
       assets/helmet.glb,gpu,recipes/helmet.gpu.recipe.toon,3294700,260468,7,3.59,0.94,ktx2 etc1s+uastc <=1024px,quantize,ktx2,complete,recipes/helmet.gpu.preview.png
       assets/helmet.glb,load,recipes/helmet.load.recipe.toon,645032,6455,107,0.81,0.905,avif q50/60 (color/data maps) <=2048px,meshopt-medium,meshopt,complete,recipes/helmet.load.preview.png
     warnings[5]: "helmet.size: output needs the draco decoder (75 KB gzip) in the viewer: three.js loader.setDRACOLoader(...); Babylon.js loads it automatically","helmet.size: uses AVIF textures (EXT_texture_avif): loaded natively by three.js r150+ and Babylon.js 7.10+, no decoder download; the browser must support AVIF", ...
     help[3]: ...,"Every result looks the same as the original when shown at 1024px (worst-region SSIM >= 0.9; previews show the worst view). If the model will be shown larger or up close (VR, zoom), tune again with --view 2048; for extra margin, raise --fidelity", ...

     size and load differ: Draco makes the smaller file, but its decoder costs
     more to start up and to decode than meshopt's, so the fastest load is the
     meshopt file, even though it is 100 KB larger.

DECODERS
     Results may need Draco, meshopt or KTX2 decoders. Babylon.js loads them
     automatically; a stock three.js GLTFLoader does not. Every result that
     needs one carries a warning naming the decoder, its size and the three.js
     call that enables it. For a file that needs none, use --for compat.
     AVIF results also carry a note: no decoder download, but the loader
     (three.js r150+, Babylon.js 7.10+) and the browser must support AVIF.

ERRORS
        error: unknown or malformed flag --stat for `optimize`
        code: USAGE
        help[1]: "valid flags for optimize: --out, --force, ... (--help always allowed)"
     Codes: USAGE (exit 2), INPUT_NOT_FOUND, UNSUPPORTED_FORMAT, INVALID_INPUT,
     OUTPUT_EXISTS, BAD_RECIPE, INTERNAL (exit 1).

EXIT STATUS
     0 success, including no-ops. 1 an input failed, or run --check found an
     output below the limit; the other outputs are still written. 2 usage error;
     nothing was done.

EXAMPLES
     node-assets
     node-assets tune assets/helmet.glb --for size,gpu -o recipes
     node-assets run recipes/helmet.size.recipe.toon assets/helmet.glb -o public/models/helmet.glb
     node-assets run recipes/helmet.size.recipe.toon assets/ -o public/models/ --check --force
     node-assets tune assets/a.glb assets/b.glb assets/c.glb --for size -o recipes   # decoders shared by 3
     node-assets inspect public/models/ --against assets/
```

## Evidence

### How it was tested

- **Agents.** Headless Claude Code (`claude -p`, Haiku and Sonnet) in a small three.js web project with source models in
  `assets/`. Each agent was given a plain task prompt and told only that `node-assets` is on PATH. Every CLI call was
  logged.
- **Variants.**
  - *knobs*: every command except `tune`. `optimize` has every searched lever as a flag, so a manual search can reach
    the same results.
  - *tune*: the full design, with TOON output.
  - *tune-json*: the same as tune, but with JSON output and recipes.
- **Tasks**, one per goal plus one with two goals:

  | Task | Goal | Prompt in short |
  |---|---|---|
  | G1 | gpu | helmet for Quest/WebXR, Babylon.js, lowest GPU memory |
  | L1 | load | toy car on phones over 4G, fastest load; may edit `viewer.js` |
  | S1 | size, 3 models | minimize first-visit bytes for 3 models, decoders included; may edit `viewer.js` |
  | C1 | compat | helmet for partners' unknown viewers, no extensions, smallest |
  | M1 | size + gpu | lantern as a small download *and* as low GPU memory; report the trade-off |

- **Grading.** Done after all runs, with graders that share no code with the CLI:
  - glTF parser for bytes, GPU estimate, decoders and extensions, plus the Khronos validator;
  - separate three.js renderer and Python SSIM for fidelity, which must be at least 0.895 (0.9 with a 0.005
    tolerance between implementations);
  - quiet-machine cold loads for L1;
  - a check that the viewer calls the right decoder setters (L1/S1).
- **Reference ("best known").** For each task, the smaller of:
  - an *oracle*: `tune` with a finer grid (quality steps of 5, sizes such as 384/768/1536, more Draco bit depths) and
    an unlimited budget on an idle machine;
  - the best agent output that met every hard constraint.

  "Near best" means within 15% (size/compat), 20% (load) or 25% (GPU memory) of that reference. Agents beat the oracle
  on S1 and M1-size, so the oracle is not exhaustive.
- **Machine.** 2 CPUs, 3 trials at a time, load average 6–8. `tune` ran slower than on an idle machine and hit its
  time limit more often. For example, the S1 3-model batch completes in 7m41s idle, but was cut off at 7 minutes in 6 of
  14 trial runs.

### Round 1 (pilot, v0.4): three defects, fixed before the main run

1. **The quality grid was too coarse.** `tune` tried only two settings: quality 90 (data maps at 95) and quality 80
   (data maps at 80).
   - A Haiku agent searching by hand found the helmet at **850 KB** within the limit (AVIF color q50, data maps q60).
     `tune` had returned 1.04 MB.
   - Fix: quality is searched for color maps and data maps separately, from 90 down to 30. The fidelity limit decides,
     not a fixed floor.
   - On the helmet, the size result went from 1.04 MB to **546 KB** (fidelity 0.901).
2. **The time limit starved later inputs.** In all 3 pilot runs that tuned 3 models at once, the 7-minute budget ran
   out before Draco or AVIF was tried on some of them. ToyCar came back at 4.48 MB; a dedicated re-run gave 0.30 MB.
   - Fix: an *anytime* search. Cheap geometry checks come first, then each format at full size, then a combination
     step, then refinements. With a 40-second budget, ToyCar now gets 551 KB.
   - Rows cut short are marked `search: partial`, and the warning gives the exact command to finish.
3. **Comparing several files at once was rejected.** Agents tried it 4 times in 3 runs: three times with several files
   against one original, once with a directory against a directory.
   - Fix: `--against FILE` compares every input with that file; `--against DIR` pairs inputs with originals by name.

### Round 2 (main, v0.5): 48 runs (5 tasks × knobs/tune × Haiku/Sonnet × 2, plus tune-json on G1/M1)

| | knobs | tune | tune-json |
|---|---|---|---|
| near best and all checks pass | 4/20 | **11/20** | 4/8 |
| median result / best known | 2.11× | **1.09×** | 1.37× |
| fidelity ≥ 0.895 (limit minus grader tolerance) | 20/20 | 20/20 | 8/8 |
| median CLI calls per run | 15.5 | 8.5 | 7.0 |
| median wall time per run | 507 s | 616 s | 291 s |

tune-json ran only on G1 and M1, so its overall numbers are not directly comparable with the other two columns.

Per task, tune vs knobs:

| Task | tune | knobs | Notes |
|---|---|---|---|
| S1, 3 models, total bytes | 4/4, **1.00×** (1.24 MB) | 0/4, 2.29–5.52× | tune shared one decoder (Draco) across all 3 models. Agents without tune searched, but their final files stayed well above the limit (fidelity 0.905–0.984). |
| C1, no extensions | 3/4, 1.02× | 0/4, 1.29–1.30× | The tune miss was a Haiku run that never called `tune`. |
| M1, small version | 4/4 at **1.00×** | 2.39–5.49× | All 8 tune runs (TOON and JSON) wrote the same 221,248-byte file (227,703 bytes counting its decoder). |
| M1, GPU version | 1.75× in every run | one Haiku run found 1.00× by hand | **Defect:** the size grid jumped from 1024 to 512; the best size was 768. |
| L1, load | 1/4, median 1.77× | 0/4, median 2.11× | **Defects:** see below. |
| G1, GPU memory | 3/4 at 1.00× | 4/4 at 1.00× | Easy task: everyone found KTX2 at 1024 px. The tune miss was a deliberate choice (below). |

What the agents did:
- **Without tune, agents searched a lot by hand but in coarse steps.** Across 20 runs: 200 `optimize` calls and 188
  quality comparisons. Some explored below the limit (two S1 Haiku runs made 39 and 26 `optimize` calls). Even so,
  the files they kept were 1.3–6.9× the best known on S1, C1, M1 and L1. On G1, everyone reached 1.0×.
- **With tune, the typical run was: `tune` once, `run` the recipe, check with `inspect --against`.**
- **Results were repeatable.** The same search gave byte-identical files across agents (M1: 8/8; S1: 3/4).
- **Time limits still bit on big batches.** 8 of 28 `tune` runs were partial: 6 of 14 in S1, which tunes 3 models at
  once on a busy 2-CPU machine. In 3 of the 4 S1 runs, agents followed the warning and re-tuned model by model; the
  fourth re-ran the batch with a 30-minute limit.
- **Agents overrode `tune`'s pick in 3 of the 18 runs that used it:**
  - Sonnet (L1) rejected a result at 0.903 ("It scored only 0.903 against a 0.9 limit, so I didn't use it").
  - Haiku (G1) re-checked at a 2048 px view because Quest's per-eye resolution is higher, and kept 2048 px textures
    (3.8× the GPU memory). This is a defensible reading of the task, not an error.
  - Haiku (L1) wrongly believed three.js can't load AVIF and swapped in WebP. AVIF loading is in the published
    packages for three.js r150 and later (checked 0.150 and 0.170) and Babylon.js 7.10 and later (7.0.0 lacks it).
- **The load ranking was noisy.** Two runs ran the same search for L1, saw the same candidates, and still picked
  different winners: 358 KB (Draco) vs 808 KB (meshopt). Decode times measured live on a busy machine decided the
  ranking.
- **TOON vs JSON made no visible difference to outcomes** (G1: 3/4 vs 4/4; M1: identical files).
  - On the 674 real outputs from these runs, JSON is 1.25× the tokens of TOON (two offline tokenizers agreed:
    1.2–1.6× by command).
  - CLI output is a small share of an agent's context, so the saving per run is small. TOON stays because you asked
    for it and the runs showed no downside.
- **Recipe editing was not used in round 2, but it was in the pilot and in round 3.** Agents edited single fields with
  `sed` and re-ran with `run --check`:
  - turning simplification off to gain quality headroom (L1, round 3);
  - deriving 2048 px and higher-quality ETC1S variants (G1, round 3);
  - a grid of quality settings (pilot S1).

  Mixing stages across goals was never needed by any task.

### Round 3 (v0.6 and v0.7): fixes for what round 2 found

Four changes and one note in the docs, each tied to a round-2 finding. The first three were re-tested with agents
(6 runs, v0.6, tune only). The load model (v0.7) was checked against measurements, not agents.

1. **Finer texture sizes (768, 1536, 3072).**
   - With agents: M1's GPU version went from 1.75× in 8/8 runs to **1.00× in 2/2**. Both runs wrote the same
     file (KTX2 UASTC at 768 px, 3.1 MiB of GPU memory), equal to the oracle.
   - Without agents, the helmet results did not change (546 KB for size, 7 MiB for GPU).
2. **AVIF compatibility note.** Every AVIF result now says that three.js r150+ and Babylon.js 7.10+ load it natively,
   with no decoder download. No round-3 agent repeated the "three.js can't load AVIF" mistake, but with n=2 that
   proves little.
3. **View-size hint.** The `tune` output now says the limit holds at the render size, and to use `--view 2048` for
   zoom or VR. This changed behavior right away:
   - Both G1 agents re-checked at 2048 px because the task says "Quest".
   - Both kept 2048 px textures: 27 MiB of GPU memory instead of 7 MiB, which is 3.8× under the grader's 1024 px view.
   - Sonnet set out the trade-off itself: "I can swap [the 1024 version] in if you tell me how close users get."
   - The two L1 agents also worried about zoom and headroom:
     - Sonnet edited tune's recipe to turn simplification off: +60 KB, 0.71 s, 1.45×.
     - Haiku hand-picked 1024 px WebP (1.07 s) over tune's 256 px pick, citing a product page "where users can zoom
       in".
4. **Deterministic load model (v0.7).**
   - *What changed:* `load` now ranks by download time plus a decode-time estimate computed from the file's
     contents: decoder start-up, geometry bytes per codec, and image megapixels per format. It no longer uses decode
     times measured live.
   - *How it was fitted:* to 64 variants of 4 models (cold loads, median of 5, idle machine). R² 0.965, mean error
     11 ms; when one model was held out, the rank correlation was 0.88–0.97.
   - *Accuracy on agent outputs:* on the 10 L1 files that agents produced, the estimate matched the grader's
     separate cold-load measurements with Spearman 0.995 and a mean gap of 0.027 s.
   - *Repeatability:* three ToyCar load runs on v0.7 (one alone, two at the same time on 2 CPUs) chose the same
     357,536-byte winner. In v0.5, two identical searches had picked 358 KB and 808 KB.
   - *Side effect:* `tune` no longer runs about a dozen cold loads per run, and `inspect` now shows load time even
     without `--against`.
   - *Measured costs:* KTX2's transcoder start-up costs ~270 ms. That is why KTX2 almost never wins `load` on small
     models, even though GPU uploads are faster.
5. **Tolerance note.** One `tune` output (lantern-small, the same file in 10 runs) scored 0.898 under the independent
   renderer, against 0.90 in `tune`. That is inside the 0.005 tolerance between renderers. A limit that must hold under
   any renderer needs a small margin (`--fidelity 0.905`).

### Lever coverage (your list)

| Lever | Status |
|---|---|
| GPU texture compression / KTX2 and its options | Searched: ETC1S, UASTC, ETC1S color + UASTC data maps, by size. ETC1S quality and UASTC level are recipe fields; only the oracle varies them. |
| Vertex quantization | Always on, except `compat` (quantization is an extension). |
| Resizing textures down | Searched: 256–4096 px, including 768/1536/3072. |
| Culling unused things | Always on (prune). |
| Merging vertices | Always on (weld). |
| Deduping identical geometry | Always on (dedup of meshes, accessors, textures, materials). |
| Instancing shared geometry | On in `tune` unless `--keep hierarchy` or `compat`. |
| Spec/gloss to PBR | Always on when the input uses spec/gloss. |
| Texture atlas | **Not built.** `palette` exists but is off; true atlasing was the lowest-ROI item. |
| Reordering vertices | Part of meshopt. |
| Meshopt and its options | Searched: medium, high (lossy filters). |
| Draco and its options | Searched: 14/10/12 and 11/8/10 bits. Decode-speed setting is fixed at 5. |
| Whitespace in the original | Covered: output is always .glb, whose JSON chunk is minified. |
| Image compression (PNG/JPEG/WebP/AVIF) | Searched per goal; quality searched separately for color and data maps. |
| Simplifying geometry | Searched: 25/50/75% (models above 2k triangles), once on the baseline geometry, then applied to each goal's geometry modes. |
| Flattening hierarchy | On in `tune` for models without animation, unless `--keep hierarchy`. |
| Decoder size, shared across assets | In the `size` and `load` metrics, split across `--amortize N` (default: number of inputs). |

### Caveats

- **Small n.** 54 graded runs in total: 48 in round 2, 6 in round 3. Per-cell counts are 2–4. The big gaps (S1, M1
  size, C1) were consistent in every run. The L1/G1 differences are within noise.
- **Busy machine.** The test machine ran 3 agents on 2 CPUs, so `tune` was slower than it would be on a laptop. That
  hurts tune, not knobs.
- **Fidelity is one metric.** It is SSIM on luminance, with headless SwiftShader rendering at one view size. Agents
  themselves showed that "visible quality loss" depends on how big the model appears on screen.
- **The best known is not the optimum.** Agents beat the oracle on 2 tasks. In particular, the step that combines
  texture and geometry settings stops after 3–4 tries per round, so `tune` can miss combinations.
- **Download size assumes no HTTP compression** on .glb files. meshopt output compresses well under gzip/brotli, so a
  gzip-aware size metric would favor meshopt more often than this one does.

### Open questions for you

1. **What should the default view be?** 1024 px reproduces the grading. Agents expecting zoom or VR kept more detail:
   - G1 agents chose 2048 px textures: 3.8× the GPU memory and 3.3–4.5× the bytes.
   - An L1 agent kept 1024 px textures instead of 256 px.

   Options: keep 1024 with the hint (current), require `--view`, or default to 2048.
2. **Should `tune` leave fidelity headroom by default** (for example 0.91 for a 0.9 limit)? Three L1 runs rejected
   `tune`'s pick at 0.902–0.903:
   - one edited the recipe to back off ("barely above the limit");
   - two chose by hand, one of them citing zoom.
3. **Mixing stages across goals is still unproven.** Editing a recipe and re-running it is used; mixing goals is not.
   It costs nothing in the code (a recipe is just stages), so it stays in the docs as an option, not a headline
   feature.

