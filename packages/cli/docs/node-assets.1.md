# node-assets(1)

The reference page for the `node-assets` command. `node-assets help` prints the text below.

Maintainers can refit the load estimate with the [dev-only Babylon.js calibration tool](calibration.md).

```text
NODE-ASSETS(1)                     User Commands                    NODE-ASSETS(1)

NAME
     node-assets - make 3D models small and web-ready, tuned for a goal
     (preview)

SYNOPSIS
     node-assets
     node-assets help
     node-assets inspect <file|dir>... [--against <original|dir>] [--view PX]
                         [--network NET]
     node-assets tune    <input>... --for GOAL[,GOAL...] [-o <dir/|file.toon>]
                         [--fidelity F] [--view PX] [--network NET]
                         [--amortize N] [--keep hierarchy,texture-size,geometry]
                         [--time-limit DUR]
     node-assets run     <graph> <input>... -o <out.glb|dir/> [--check] [--force]
     node-assets show    <graph>
     node-assets <command> --help
     node-assets --version

DESCRIPTION
     A graph is an ordered list of processing blocks and their settings,
     stored as a small TOON file (https://toonformat.dev). tune searches the
     settings for the best result for a goal and writes the winner as a graph.
     run applies a graph to any number of models. show prints a graph with
     every setting filled in.

     Built-in graphs are named without a path or extension:
       optimize   WebP textures up to 2048 px (color q90, data maps q95),
                  quantized geometry, lossless cleanup. No fidelity search.

     Every tuned result stays within a fidelity limit. The original and the
     candidate are rendered with Babylon.js from the same 4 views. A
     candidate passes only if its worst 64 px region still scores the limit
     or higher (SSIM, 1 = identical; default 0.9 at 1024 px). The limit holds
     at the render size, so set --view to the largest size the model will
     appear on screen: 2048 for a zoomable product viewer or VR close-ups.
     Fidelity is rounded to 3 decimals before display and limit checks.

     Output is TOON on stdout; progress goes to stderr. Nothing prompts.
     Errors are TOON on stdout too, with a code and a fix.
     Inputs: .glb .gltf .fbx .obj (+.mtl) .stl .usd .usda .usdc .usdz.
     Output: .glb.

QUICK START
     node-assets tune model.glb --for size -o graphs/
     node-assets run graphs/model.size.toon model.glb -o public/model.glb

GOALS (tune --for)
     size     Smallest download: file bytes (no HTTP compression assumed) plus
              the Babylon.js decoders the file needs (gzip: meshopt 7 KB, Draco
              75 KB, KTX2 265 KB). Decoder bytes are split across --amortize N
              assets (default: the number of inputs), because a visitor
              downloads each decoder once.
     gpu      Lowest GPU memory (estimate). Textures: 4 B/px decoded (PNG,
              JPEG, WebP, AVIF) or 1 B/px (KTX2), plus 1/3 for mipmaps. Vertex
              data: stored component sizes, except that Draco decodes to
              float32.
     load     Fastest first display: download time on --network (slow-4g
              1.6 Mbps, 4g 9 Mbps default, wifi 30 Mbps), decoders included,
              plus decode time estimated from the file's contents (decoder
              start-up, geometry bytes per codec, image megapixels per format).
              The estimate is deterministic, so the same input always ranks
              the same way.
     compat   Loads in any glTF 2.0 viewer: fewest required extensions (no
              decoders, no WebP/AVIF/KTX2, no quantization), then smallest.

     Several goals in one run share work and write one graph per goal. Ties
     (goal metric within 1%) go to higher fidelity, then to smaller files.

LEVERS
     Always on, lossless: remove unused data, merge duplicates, merge
     identical vertices, convert spec/gloss materials to metal/rough. tune also
     flattens the hierarchy (models without animation) and instances repeated
     meshes, unless --keep hierarchy is given.
     Searched, all within the fidelity limit:
       texture format   AVIF, WebP (size, load); KTX2 ETC1S, UASTC, or ETC1S
                        color + UASTC data maps (gpu); JPEG, PNG (compat)
       texture size     256 to 4096 px, up to the original, by bisection
       texture quality  for color maps and data maps (normal, metal/rough,
                        occlusion) separately
       geometry         quantize; meshopt (medium/high); Draco at 14/10/12 or
                        11/8/10 bits; none (compat)
       simplification   keep 75%, 50% or 25% of triangles (models above 2k
                        triangles, unless --keep geometry)

COMMANDS
  (no arguments)
     Home view: the executable, what the tool does, the models and graphs
     under the current directory (largest first), the built-in graphs, and
     next steps.

  help
     Prints this page.

  inspect <file|dir>...
     Read-only. Bytes, estimated GPU memory, estimated load time on
     --network, triangles, textures, decoders and required extensions, one
     row per file, largest first.
     --against ORIGINAL  also renders each file and the original and adds
                         fidelity and the original's numbers
     --against DIR       compares each file with the same-named file in DIR
     --view PX           render size for --against (default 1024)

  tune <input>... --for GOAL[,GOAL...]
     For each input and goal, writes into -o (default: the current directory):
       <model>.<goal>.toon    the winning graph, with provenance
       <model>.<goal>.png     original | result, at the worst view
     -o FILE.toon names the graph (one input and one goal only); the preview
     is written next to it with a .png extension.
     Prints, per input and goal: the graph path, bytes, decoder bytes, GPU MiB,
     load seconds, fidelity, the chosen textures and geometry, the decoders
     needed, whether the search completed, and the preview path, plus the
     originals' numbers. tune does not write models; use run.
     --fidelity F    limit, 0-1 (default 0.9)
     --view PX       render size for the fidelity check (default 1024)
     --network NET   for the load goal: slow-4g, 4g (default), wifi
     --amortize N    share decoder bytes across N assets (default: inputs)
     --keep ...      hierarchy (no flattening or instancing), texture-size
                     (no downscaling), geometry (no simplification)
     --time-limit D  budget for the whole run, e.g. 90s, 5m (default 7m). A
                     run cut short still writes the best results so far,
                     marks them "search: partial", and gives the command that
                     finishes the search. The budget stops new search work;
                     each input's baseline is always checked, and compat also
                     checks an original-size PNG fallback when the original
                     textures need extensions. Agent shells often stop
                     commands after about 10 minutes; tune one model per call
                     when a batch needs longer.

  run <graph> <input>... -o <out.glb|dir/>
     Applies a graph file or a built-in graph. Several inputs or a directory
     need -o dir/. Each output records which graph and input produced it, so
     running the same command again is a no-op ("up to date", exit 0). Any
     other existing file needs --force.
     --check  renders each output against its input and fails (exit 1) any
              that fall below the graph's limit (check.fidelity at check.view;
              0.9 at 1024 px when the graph has none). Use it after editing a
              graph, or before reusing one on other models.
     --force  replace existing outputs

  show <graph>
     Prints a graph file or built-in graph with every block setting filled
     in. To customize a built-in graph:
       node-assets show optimize > graphs/mine.toon
     then edit graphs/mine.toon and run it with --check.

GRAPHS
     Blocks run in order; each reads the previous block's output. run adds
     the input block (chosen by file extension) and the GLB output block. A
     block may name another block's id as its input. Omitted settings take
     the block's defaults; unknown blocks, unknown settings and out-of-range
     values are errors that name the valid ones. To mix goals, copy blocks
     from one graph into another, then check the result with run --check.

        graph: 1
        name: helmet.size
        goal: size
        blocks[10]:
          - type: transform.metal-rough
          - type: transform.dedup
          ...
          - type: transform.encode-textures
            config:
              format: avif
              quality: 60
              slots: color
          - type: transform.encode-draco
            config:
              quantizePosition: 14
              ...
        check:
          fidelity: 0.9
          view: 1024
        tuned:
          input: assets/helmet.glb
          ...

     Blocks (run `node-assets show <graph>` for every setting and default):
       transform.metal-rough       spec/gloss materials to metal/rough
       transform.dedup             merge duplicate data
       transform.cull-unused       remove unused data
       transform.weld              merge identical vertices
       transform.flatten           flatten the hierarchy (not animated models)
       transform.instance          GPU-instance repeated meshes
       transform.resize-textures   fit textures within maxSize
       transform.encode-textures   WebP, AVIF, JPEG or PNG at a quality
       transform.encode-ktx2       KTX2 (ETC1S / UASTC)
       transform.simplify          reduce triangles
       transform.quantize          store vertex data in smaller types
       transform.dequantize        restore float vertex data for compatibility
       transform.encode-meshopt    meshopt geometry compression
       transform.encode-draco      Draco geometry compression
       transform.strip-materials   remove all materials
     Texture blocks take slots: color, data (normal, metal/rough, occlusion)
     or all. Textures used as both color and data are left unchanged.

DECODERS
     Results may need Draco, meshopt or KTX2 decoders. Babylon.js loads them
     automatically; other viewers must be set up to load them. Every result
     that needs one carries a warning. For a file that needs none, use
     --for compat. AVIF results need a browser with AVIF support.

BROWSER
     tune, run --check and inspect --against render in a headless browser,
     using the first of: $NODE_ASSETS_CHROMIUM, Google Chrome, Microsoft Edge,
     Playwright's Chromium. If none is found, the error code is NO_BROWSER;
     fix it with: npx playwright install chromium
     The other commands need no browser.

ENVIRONMENT
     NODE_ASSETS_CHROMIUM   path to a Chrome or Chromium executable

ERRORS
        error: unknown goal "speed"
        code: USAGE
        help[1]: "goals: size, gpu, load, compat"
     Codes: USAGE (exit 2); INPUT_NOT_FOUND, UNSUPPORTED_FORMAT,
     INVALID_INPUT, OUTPUT_EXISTS, BAD_GRAPH, NO_BROWSER, INTERNAL (exit 1).

EXIT STATUS
     0 success, including no-ops. 1 an input failed, or run --check found an
     output below the limit; the other outputs are still written. 2 usage
     error; nothing was done.

LIMITS
     Preview release. USD input needs Web Worker support
     (NODE_OPTIONS=--experimental-web-worker on Node versions that offer it).
     The fidelity check renders the static pose only. size counts raw bytes,
     not gzip or brotli transfer size. The load model's coefficients are
     provisional. The fidelity limit is a numerical SSIM check, not a
     validated perceptual guarantee; the 0.9 default has not yet been
     re-validated on the Babylon.js renderer, so check the previews. Scores
     can differ slightly between browsers and machines.

EXAMPLES
     node-assets
     node-assets run optimize assets/helmet.glb -o public/models/helmet.glb
     node-assets tune assets/helmet.glb --for size,gpu -o graphs/
     node-assets run graphs/helmet.size.toon assets/ -o public/models/ --check
     node-assets show optimize > graphs/mine.toon
     node-assets inspect public/models/ --against assets/
```
