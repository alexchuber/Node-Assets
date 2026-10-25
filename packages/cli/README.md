# Node Assets CLI

> **Preview (v0.1.0).** Expect rough edges and breaking changes. Not published to npm.

`node-assets` makes 3D models small and web-ready. Pick a goal: download size, GPU memory, load time or
compatibility. `tune` then searches the optimization settings for the best result that stays within a fidelity
limit: each candidate and the original are rendered with Babylon.js from 4 views and compared (worst-region SSIM,
0.9 or higher at 1024 px by default). The winning settings are saved as a small, editable graph file that `run`
applies to any number of models.

The CLI is built for coding agents as well as people: output is [TOON](https://toonformat.dev) on stdout, errors carry
a code and a fix, and nothing prompts.

## Install

Requires Node.js 20.19+, 22.13+ or 24+.

```sh
npm i -g https://github.com/alexchuber/Node-Assets/releases/download/cli-v0.1.0/node-assets-cli-0.1.0.tgz
node-assets --version
```

`tune`, `run --check` and `inspect --against` render in a headless browser. They use Google Chrome, Microsoft Edge or
Chromium if one is installed. If none is found, install one with:

```sh
npx playwright install chromium
```

To use a specific browser, set `NODE_ASSETS_CHROMIUM` to its executable path.

### Agent skill

Give your coding agent (Claude Code, Copilot, Cursor, Codex and others) a skill that tells it when and how to use the
CLI. The skill is a thin wrapper: it points the agent at `node-assets help`, so the instructions always match the
installed version.

```sh
npx skills add https://github.com/alexchuber/Node-Assets/tree/cli-v0.1.0/skills/node-assets-cli
```

## Quick start

```sh
node-assets tune model.glb --for size -o graphs/
node-assets run graphs/model.size.toon model.glb -o public/model.glb
```

`tune` writes `graphs/model.size.toon` (the settings) and `graphs/model.size.png` (original next to the result, at the
view that changed most). `run` applies the graph and writes the optimized model.

## Workflows

| Task | Command | What it does |
|---|---|---|
| See what's here | `node-assets` | Lists the models and graphs under the current directory, the built-in graphs, and next steps. |
| Measure models | `node-assets inspect assets/` | Bytes, GPU memory estimate, load time estimate, triangles, textures and required decoders, one row per model. |
| Tune for one goal | `node-assets tune assets/helmet.glb --for size -o graphs/` | Finds the smallest download within the fidelity limit at 1024 px, and writes `helmet.size.toon` + `helmet.size.png`. |
| Tune for several goals | `node-assets tune assets/helmet.glb --for size,gpu,load,compat -o graphs/` | One search, one graph per goal, so you can compare and pick. |
| Name the graph yourself | `node-assets tune assets/helmet.glb --for gpu -o graphs/helmet-quest.toon` | Writes to the given file (one input and one goal). |
| Tune for close-ups or VR | `node-assets tune assets/helmet.glb --for gpu --view 2048 -o graphs/` | Holds fidelity at 2048 px instead of 1024 px. |
| Tune a set of models | `node-assets tune assets/a.glb assets/b.glb assets/c.glb --for size -o graphs/` | Counts each decoder's download once across the set. |
| Apply a graph | `node-assets run graphs/helmet.size.toon assets/helmet.glb -o public/helmet.glb` | Writes the optimized model. Running it again is a no-op. |
| Reuse a graph on other models | `node-assets run graphs/helmet.size.toon assets/ -o public/ --check` | Applies the graph to every model in `assets/`, renders each result against its original and fails any below the limit. |
| Quick optimize, no browser | `node-assets run optimize assets/helmet.glb -o public/helmet.glb` | Built-in graph: WebP textures up to 2048 px, quantized geometry, lossless cleanup. No fidelity search. |
| Customize a graph | `node-assets show optimize > graphs/mine.toon` | Prints every block and setting with its default. Edit the file, then `run` it with `--check`. |
| Compare results with originals | `node-assets inspect public/ --against assets/` | Renders each file next to the original of the same name and reports fidelity. |
| Read the full guide | `node-assets help` | Prints the manual: goals, levers, graph format, output, errors. |

Inputs can be `.glb`, `.gltf`, `.fbx`, `.obj` (with `.mtl`), `.stl` and `.usd`/`.usda`/`.usdc`/`.usdz`. Output is
always `.glb`.

## Reading the output

Results are TOON on stdout: compact, indented `key: value` lines, with tables as `name[rows]{columns}:`. Progress goes
to stderr. For example, `node-assets inspect duck.glb helmet.glb` prints:

```text
count: 2 models found
models[2]{file,status,bytes,gpu_mib,load_s,triangles,textures,decoders,required_extensions}:
  helmet.glb,ok,3773916,107.2,3.57,15452,5x jpeg 2048x2048,none,none
  duck.glb,ok,120484,1.4,0.15,4212,1x png 512x512,none,none
```
 A `tune` result row lists the graph it wrote, bytes, decoder bytes, GPU MiB, estimated load seconds,
fidelity, the chosen textures and geometry, the decoders the file needs, whether the search finished, and the preview
image. `warnings` names any decoder the result needs; `help` suggests next commands. Errors look like this and exit 1
(or 2 for usage errors):

```text
error: unknown goal "speed"
code: USAGE
help[1]: "goals: size, gpu, load, compat"
```

## Why `tune` (prototype research)

These results come from the research prototype that this CLI was ported from (plain JavaScript, with a different
renderer for its fidelity check), not from this release. The Babylon.js port keeps the same search but has not been
re-graded yet.

In 54 graded runs of coding agents on that prototype, agents that used `tune` landed at a median **1.09×** the best
known result. Agents that set the same options by hand landed at **2.11×**. Near-best results: 11/20 with `tune`, 4/20
without. Every result in both groups passed an independent fidelity check. Details, method and caveats:
[research/cli-v2/docs/node-assets.2.md](../../research/cli-v2/docs/node-assets.2.md).

## Known limits

- **Preview.** The CLI is a TypeScript port of the research prototype. It renders fidelity with Babylon.js, so its
  results have not been re-graded against the research numbers yet.
- The 0.9 fidelity default was chosen with the prototype's renderer and has not been re-validated on the Babylon.js
  renderer. Look at the preview images, and raise `--fidelity` or `--view` if you need more margin.
- Tested on macOS so far. Windows and Linux paths are covered by unit tests only.
- The `load` goal estimates decode time with a model whose coefficients are provisional until they are refit on
  Babylon.js cold loads (see [docs/calibration.md](docs/calibration.md)).
- Fidelity is checked on the static pose only; animated and skinned models are not posed.
- `size` counts raw file bytes, not gzip or brotli transfer size.
- Fidelity scores can differ slightly between browsers and machines.
- A long `tune` on several large models can hit its time limit (`--time-limit`, default 7 minutes). It still writes
  the best results so far and prints the command that finishes the search.
- USD input needs Web Worker support (`NODE_OPTIONS=--experimental-web-worker` on Node versions that offer it).
- Results that use Draco, meshopt or KTX2 need the matching decoder in the viewer. Babylon.js loads them
  automatically; for a file that needs none, use `--for compat`.

## Develop locally

From the repository root:

```sh
pnpm install
pnpm build
pnpm cli --help
pnpm vitest run tests/e2e/cli.test.ts
```

To build the installable tarball, commit your changes first, then:

```sh
cd packages/cli && npm pack
```

`npm pack` refuses uncommitted changes in the build inputs, rebuilds core and the CLI, and records the commit in
`dist/build-info.json` inside the tarball.
