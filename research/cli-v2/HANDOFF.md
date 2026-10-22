# Handoff: node-assets CLI v2 (goal-tuned recipes)

Branch `cli-redesign-v2`, based on `cli-redesign`. Everything for this work lives in `research/cli-v2/`. The only
change outside it is one line in `eslint.config.mjs`, which ignores `research/**` so `pnpm lint` stays green.

## TL;DR

- **What this is.** A research prototype (v0.7, plain Node ESM) of an agent-facing CLI. You give it a **goal**
  (`size`, `gpu`, `load` or `compat`). It searches the optimization levers for the best result that still **looks
  the same** (fidelity is a limit, checked by rendering), and it writes the winning settings as a small, editable
  **recipe** (TOON).
- **Status.** It works end to end and has been tested with headless Claude agents (54 graded runs). It is **not**
  integrated into `packages/cli`, and it has no unit tests. The TypeScript CLI in `packages/` is untouched.
- **Headline result** (round 2, 48 runs). Agents using `tune` got a median **1.09×** the best known result. Agents
  using only manual flags got **2.11×**. Near-best success was 11/20 vs 4/20. Every output passed an independent
  fidelity check (≥ 0.895).
- **Read next.**
  1. `docs/node-assets.2.md`: the full man page, the evidence, and how it was tested.
  2. The "Open design questions" section below.

## What was asked, in order

1. **Oct 21, original brief.** Design the best CLI for agents to get assets optimized and web-ready. Ground it in
   research, including your own trials of design ideas against real agents. Produce a man-like page. MVP only: keep
   the highest-ROI features. → **v1** (`docs/node-assets.1.md`): `inspect` + `optimize`, with evidence.
2. **Oct 22, brainstorm, then a spec.** These are the user's words, condensed:
   - **Optimization.**
     - Optimize for **one of: download size, GPU memory, load speed, compatibility**.
     - Use as many levers as applicable and min/max them. Skip only what doesn't apply or would work against the
       goal.
     - Levers named: KTX2 and its options, vertex quantization, texture resizing, culling unused data, merging
       vertices, deduping geometry, instancing, spec/gloss → PBR, texture atlas, vertex reordering, meshopt and its
       options, Draco and its options, whitespace, PNG/JPEG/WebP/AVIF compression, simplification, flattening.
   - **Fidelity is a limit.** Render in the loop to check it.
   - **Decoders.**
     - Draco, meshopt and KTX2 are widely supported, so there's no explicit opt-in, but warn when one is needed.
     - Download size includes decoder size, measured from the codecs' WASM/JS, and that cost is shared when many
       assets use the same decoder.
   - **Recipes.** The tuning loop produces **repeatable recipe/pipeline files** that an agent can review, edit,
     re-apply to similar models, and mix. One run can produce **one recipe per goal**, so the agent can pick or mix
     them.
   - **Output format.** Follow the **AXI guidelines** ([axi.md](https://axi.md), read via its agent-skill
     SKILL.md), e.g. use **TOON instead of JSON**.

## The CLI today (v0.7) in one screen

```text
node-assets                                   home: models + recipes here, next steps
node-assets inspect  <file|dir>... [--against <original|dir>] [--view PX] [--network NET]
node-assets tune     <input>... --for size|gpu|load|compat[,...] [-o DIR] [--fidelity 0.9]
                     [--view 1024] [--network 4g] [--amortize N]
                     [--keep hierarchy,texture-size,geometry] [--time-limit 7m]
node-assets run      <recipe> <input>... -o <out.glb|dir/> [--check] [--force]
node-assets optimize <input>... -o <out.glb|dir/> [lever flags]     (manual route, no fidelity check)
node-assets setup    [--hook] [--skill]                             (opt-in Claude Code integration)
```

- **Typical flow.** Run `tune` (writes `<name>.<goal>.recipe.toon`, a preview PNG and a candidate table), then
  `run` the recipe. Optionally check with `inspect --against`.
- **Output.** TOON on stdout and progress on stderr. Errors are TOON too, with a code and a fix. Exit codes: 0
  ok/no-op, 1 failure, 2 usage error.
- **Full man page.** `docs/node-assets.2.md`.

## Layout

```text
research/cli-v2/
  HANDOFF.md                 this file
  docs/
    node-assets.2.md         v2 man page + evidence (pilot, main round, confirmation round), lever coverage, caveats
    node-assets.1.md         v1 man page + evidence (Oct 21; superseded, kept for context)
  prototype/                 the v0.7 CLI (own package.json; not in the pnpm workspace)
    bin.mjs                  entry; fast --version
    cli.mjs                  AXI surface: commands, flags, help, TOON output, errors, home view, setup
    engine.mjs               levers + applyRecipe(): cleanup, textures (format/size/quality per map type, KTX2), geometry
    tune.mjs                 the anytime search (rounds, size/quality bisection, stage combination), NA_ORACLE grid
    render.mjs, render.html  headless three.js renderer; worst-64px-tile SSIM over 4 views, computed in-page
    loadmodel.mjs            deterministic decode-time model (fitted coefficients)
    measure.mjs              GPU estimate, decoder sizes, required extensions, glTF validator
    recipe.mjs               recipe schema (strict), TOON/JSON (de)serialization, provenance hash
    launcher.mjs             trial-only wrapper: logs every CLI call; maps variant -> NA_TUNE / NA_FORMAT
    calib/                   load-model calibration: calib_load.mjs, fit_load.py, calib_load.json, model_vs_grader.mjs
  harness/                   agent-trial harness + independent graders (own package.json)
    harness2.py              v2 trials: variants (knobs / tune / tune-json), tasks G1 L1 S1 C1 M1, run + grade
    harness.py               v1 harness (only its helpers are used by harness2: env scrubbing, transcript parsing)
    final_grade.py           grades against the best known result (oracle or best valid agent output)
    build_ref.py             applies the oracle recipes and measures them with the graders -> ref2.json
    run_oracle3.sh           re-runs the oracle (finer-grid) tunes into oracle/ref3 and oracle/ref3_s1
    grader2/                 glbinfo2.mjs (bytes/GPU/decoders/validator), coldload.cjs (cold load timing)
    render/                  render.cjs + compare.py: separate three.js renderer + Python SSIM for fidelity
    summary.py, calls.py     analysis: per-variant/per-task tables; per-trial CLI call logs
    toon_vs_json_tokens.mjs  token comparison of real outputs (two offline tokenizers)
    template/                the small three.js site each agent works in; fetch_assets.sh downloads the models
    oracle/                  committed oracle recipes + candidate tables (ref3, ref3_s1)
    ref2.json                oracle metrics used for grading
  data/
    results/<tag>__<task>__<variant>__<model>__r<rep>/   result.json (graded), calls.jsonl (every CLI call)
    transcripts.tar.gz       full agent transcripts for the same runs (stream-json)
    best_known_*.json, g2_summary.json, final_grade_g2_g3.log, g1/g2/g3.log, toon_vs_json_tokens.txt
```

Trial tags:
- `g1` is the pilot on v0.4, stopped early after 3 complete runs.
- `g2` is the main round on v0.5: 48 runs.
- `g3` is the confirmation round on v0.6: 6 runs.

## Running it

**Prerequisites:**
- Node ≥ 20.19.
- Python 3 with `numpy`, `scipy` and `pillow` (graders only).
- A Chromium for Playwright: `npx playwright install chromium`, or set `NA_CHROMIUM=/path/to/chrome`.
- For agent trials, the `claude` CLI and an API key (`ANTHROPIC_API_KEY`).
- For FBX/OBJ/STL/USD inputs, the core package must be built (`pnpm install && pnpm build:core` at the repo root).
  `.glb` and `.gltf` inputs don't need it.

```sh
cd research/cli-v2/prototype && npm install
cd ../harness && npm install && sh template/fetch_assets.sh     # ~33 MB of Khronos/three.js sample models, SHA-1 checked
cd template
node ../../prototype/bin.mjs                                     # home view
node ../../prototype/bin.mjs tune assets/helmet.glb --for size,gpu,load -o recipes/   # ~4 min on 2 CPUs
node ../../prototype/bin.mjs run recipes/helmet.size.recipe.toon assets/helmet.glb -o out/helmet.glb --check
```

Re-analyze the committed runs without re-running anything:

```sh
cd research/cli-v2/harness
NA_TRIALS=../data/results python3 summary.py g2      # the round-2 tables in docs/node-assets.2.md
NA_TRIALS=../data/results python3 calls.py "g2__S1__*"
```

Re-running trials:
- **Cost and time.** About $0.003–0.13 per run, as reported by `claude -p`. On 2 CPUs at concurrency 3, each run
  takes 3–45 minutes; runs are capped at 45.
- **Run:** `python3 harness2.py run --spec "knobs=G1,L1,S1,C1,M1;tune=G1,L1,S1,C1,M1" --models haiku,sonnet --reps 2 --tag g4`.
- **Grade:** then `python3 final_grade.py g4`. It renders every output and needs an idle machine for the L1 cold
  loads.
- **Oracle.** To rebuild it, run `sh run_oracle3.sh` (~30 min idle), then `python3 build_ref.py`.

Environment variables:

| Var | Effect |
|---|---|
| `NA_CHROMIUM` | Chromium executable for the renderers (default: Playwright's) |
| `NA_CORE` | path/URL of `packages/core/dist/index.js` (default: resolved from the repo) |
| `NA_THREE_ROOT` | directory serving `/node_modules/three` to the render page (default: `prototype/`) |
| `NA_TUNE=0` | hides `tune` and `run` (the "knobs" variant used in trials) |
| `NA_FORMAT=json` | JSON output and `.recipe.json` recipes instead of TOON |
| `NA_ORACLE=1` | finer search grid, only for computing grading references |
| `NA_HARNESS_DIR`, `NA_TUNER`, `NA_TRIALS` | harness working dir, prototype dir, trials dir |

## How `tune` works (short)

- **Baseline.** Lossless cleanup always runs: prune, dedup, weld, spec/gloss → metal/rough. For models without
  animation, it also flattens the hierarchy and instances repeated meshes, unless `--keep hierarchy` is given.
- **Two stages, scored separately.** Textures and geometry are each scored on their own (bytes add up). The search
  then builds and scores the best *predicted* combinations of the two. When a combination fails the limit, every
  combination that is lossier in both stages is ruled out.
- **Rounds, most promising first ("anytime").** A run stopped by `--time-limit` still has a good answer, and marks
  its rows `search: partial`. The warning then gives the command to finish.
  1. Each goal's first-choice geometry modes; its first-choice texture format at full size; combine; then texture
     size by bisection.
  2. Texture quality 90 → 30, for both map types together, then color maps and data maps separately; lossier Draco;
     simplification; combine.
  3. Other texture formats; combine.
- **Metrics.**
  - `size` = bytes + decoders ÷ `--amortize`.
  - `gpu` = an estimate: 4 B/px for decoded images, 1 B/px for KTX2, +⅓ for mips, vertex data at stored sizes
    (Draco decodes to float32).
  - `load` = download time on `--network` + estimated decode time (`loadmodel.mjs`).
  - `compat` = fewest required extensions, then bytes.
- **Determinism.** The same input gives the same recipe. In the trials, 8 of 8 agents wrote byte-identical lantern
  files.

## Open design questions (decisions needed)

1. **Default `--view` (the size the fidelity limit applies at).**
   - Today: 1024 px, plus a hint to use 2048 for zoom/VR.
   - Agents read context ("Quest", "product page") and chose 2048 px. That cost about 3.8× the GPU memory and
     3.3–4.5× the bytes on the helmet.
   - Options: keep (current), make `--view` required, or default to 2048.
2. **Fidelity headroom.** `tune` lands right at the limit: 0.901–0.905. In 3 load-time runs, agents rejected or
   edited picks at 0.902–0.903. Should the default limit carry a margin, e.g. pass at 0.9 but aim for 0.91? Or should the results
   table offer a "safer" row?
3. **Mixing recipe stages across goals** (from the brainstorm). Agents *edited* recipes, using `sed` and then
   `run --check`, to back off simplification or raise texture size. No task needed mixing goals, so mixing is
   unproven. Keep it as documented-only, design a task that tests it, or drop it from the docs?
4. **The size metric ignores HTTP compression.** It counts raw file bytes, while decoder sizes are counted
   gzipped. meshopt is designed to be gzipped afterwards, so a gzip/brotli-aware size would change some winners.
   Add `--transfer gzip|br|none`?
5. **How far does the load model carry?**
   - It was fitted on 64 variants in headless Chromium with SwiftShader on a 2-CPU VM. R² 0.965; held-out rank
     correlation 0.88–0.97; Spearman 0.995 against the graders' measurements on agent outputs.
   - Phones decode more slowly, and the ratios between codecs may differ.
   - Options: per-device-class coefficients, a `--device` flag, or accept "reference desktop" ranking.
6. **The fidelity metric itself.**
   - Luminance SSIM, worst 64 px tile, 4 orbit views at one size, static pose only. Animations and skins are not
     posed.
   - Color shifts, normal-map subtleties and animated models are under-tested.
   - Is this the proxy we want? Should views include close-ups?
7. **Search depth vs time.**
   - The combination step builds at most 3–4 candidates per round, and agents beat the oracle on 2 tasks.
   - Under CPU contention, multi-model batches often end `partial`: 6 of 14 S1 runs. On a laptop it's fine.
   - Options: raise the default limit (agent shells kill commands at ~10 min), parallelize renders, or tune one
     model per call automatically.
8. **Where this should live.**
   - Port to `packages/cli` (TypeScript), following AGENTS.md: docs first in `packages/core/docs/usage.md`, no
     module-level side effects.
   - How should recipes relate to the existing blocks/pipeline model? The brainstorm suggested recipes as the roots
     of the node graph.
9. **Keep `optimize`?** It is the manual route, with every lever as a flag. Agents without `tune` used it heavily
   and did 2× worse. Keep it as an escape hatch, fold it into `run` with inline overrides, or drop it?
10. **Levers not built or not searched.**
    - Texture atlasing (`palette` exists but is off).
    - KTX2 RDO, UASTC level and ETC1S quality: these are recipe fields only the oracle varies.
    - Draco decode-speed setting (fixed at 5).
    - Per-map-type texture *size* (only quality is per map type).
11. **TOON vs JSON.** TOON stays, per the brief.
    - Evidence: outcomes were the same, and JSON is ~1.25× the tokens on 674 real outputs.
    - Note: the repo's own `AGENT_CLI_RESEARCH.md` says TOON over JSON is not established. Our trials neither
      prove nor contradict that beyond "no harm, ~20% fewer output tokens".
12. **AVIF support claims.** The tool says three.js r150+ and Babylon.js 7.10+ load AVIF.
    - Verified in the published npm packages: three 0.150 and 0.170 have the loader extension; Babylon loaders 7.0.0
      lacks it and 7.10.0 has it.
    - The exact first Babylon version between 7.0 and 7.10 is unknown.
    - Browser support is not checked.

## Known issues and limitations

- **No tests.** The prototype is research code: no unit tests, and no TypeScript.
- **Small samples.** 2–4 runs per cell. The big gaps (S1, M1 size, C1) were consistent; L1/G1 differences are
  within noise.
- **Busy trial machine.** Trials ran 3 agents on 2 CPUs, which penalized `tune`'s wall-clock budget.
- **Grader tolerance.** The independent grader allows 0.005 between renderers. One `tune` output (lantern-small)
  scored 0.898 there, against 0.90 in `tune`.
- **Fidelity ignores animation.** Animated/skinned models are kept unflattened, but the fidelity check renders the
  rest pose only.
- **Fixed constants.** Decoder sizes (gzip) are measured from three r180's decoders: meshopt 6.5 KB, Draco 75 KB,
  KTX2 260 KB. Network presets are slow-4g 1.6, 4g 9 and wifi 30 Mbps.
- **`harness.py` contains v1 variants** that refer to a v1 prototype not included here. Only its helper functions
  are used by `harness2.py`.

## Suggested next steps

1. Decide open questions 1–3. They change defaults and the docs, not the architecture.
2. Write the user-facing contract first in `packages/core/docs/usage.md`, per AGENTS.md. Then port `tune`, `run`,
   the recipe schema and the fidelity check into `packages/cli`, with unit tests:
   - recipe schema;
   - serialization;
   - provenance and no-op runs;
   - search ordering on a tiny model.
3. Re-run a trial subset against the port to confirm parity, e.g. `--spec "tune=S1,M1,C1"`. Grading against
   `data/best_known_g2_g3.json` keeps the numbers comparable.
4. Add a task that requires mixing recipe stages (question 3) and a task with an animated model (question 6).

## Session timeline (for context)

- **Oct 21.** v1 research and trials, then the MVP man page (`docs/node-assets.1.md`).
- **Oct 22.**
  - Brainstorm, then the spec above.
  - v0.4 prototype and pilot: found a coarse quality grid, time-limit starvation, and single-file `--against`.
  - v0.5: 48-run main round.
  - v0.6: finer texture sizes, AVIF note and view hint; 6-run confirmation.
  - v0.7: deterministic load model.
  - An independent agent fact-checked the numbers in `docs/node-assets.2.md`, and the corrections were applied.
