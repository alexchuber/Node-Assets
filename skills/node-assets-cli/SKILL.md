---
name: node-assets-cli
description: Make 3D models (.glb, .gltf, .fbx, .obj, .stl, .usd) small and web-ready without visible quality loss. Use when asked to optimize, compress, shrink, or tune 3D assets for download size, GPU memory, load time, or compatibility, or to check that an optimized model still looks like the original.
---

# node-assets CLI

The `node-assets` CLI ships its own instructions, matched to the installed version. Read them from the CLI;
don't rely on memory or on this file for commands and flags.

1. Check that it is installed: `node-assets --version`. If the command is missing, install it:

    ```sh
    npm i -g https://github.com/alexchuber/Node-Assets/releases/download/cli-v0.1.0/node-assets-cli-0.1.0.tgz
    ```

2. Run `node-assets` with no arguments. It lists the models and graphs in the current project and the next steps.
3. Run `node-assets help` for the full guide, and `node-assets <command> --help` for a command's flags and examples.

Prefer `tune` over choosing settings by hand: it searches for the best result that still looks the same and writes
it as a graph file that `run` applies. Output is TOON on stdout; errors include a code and a fix.
