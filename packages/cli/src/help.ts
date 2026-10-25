import man from "../docs/node-assets.1.md?raw";
import type { Command } from "./arguments";

export function manual(): string {
    return man.match(/```text\r?\n([\s\S]*?)\r?\n```/)![1]! + "\n";
}

export function commandHelp(command: Command) {
    switch (command) {
        case "inspect":
            return {
                usage: "node-assets inspect <file|dir>... [--against <original|dir>] [--view PX] [--network NET]",
                description:
                    "Read-only. Bytes, estimated GPU memory and load time, triangles, textures, decoders and required extensions, largest first. --against renders the original and candidate from the same four views.",
                flags: [
                    "--against FILE|DIR: compare every input with FILE, or the same-named original in DIR",
                    "--view PX: render size (default 1024)",
                    "--network slow-4g|4g|wifi: 1.6, 9 or 30 Mbps (default 4g)",
                    "-h, --help",
                ],
                examples: ["node-assets inspect assets/", "node-assets inspect output.glb --against original.glb", "node-assets inspect public/models/ --against assets/"],
            };
        case "run":
            return {
                usage: "node-assets run <graph> <input>... -o <out.glb|dir/> [--check] [--force]",
                description:
                    "Apply a graph file or built-in graph. Several inputs or a directory require a directory output. Identical graph and input provenance is a no-op; other existing outputs need --force. Never overwrites an input.",
                flags: [
                    "-o, --out FILE.glb|DIR/: required output",
                    "--check: render against input at check.view and check.fidelity (defaults 1024 and 0.9); below limit exits 1",
                    "-f, --force: replace existing outputs",
                    "-h, --help",
                ],
                examples: ["node-assets run optimize model.glb -o public/model.glb", "node-assets run graphs/model.size.toon assets/ -o public/models/ --check --force"],
            };
        case "show":
            return {
                usage: "node-assets show <graph>",
                description:
                    "Print a graph file or built-in graph as TOON, with every block setting filled in. Bare names select built-ins; a path or .toon extension selects a file.",
                flags: ["-h, --help"],
                examples: ["node-assets show optimize", "node-assets show optimize > mine.toon", "node-assets show mine.toon"],
            };
        case "tune":
            return {
                usage: "node-assets tune <input>... --for GOAL[,GOAL...] [-o <dir/|file.toon>] [--fidelity F] [--view PX] [--network NET] [--amortize N] [--keep hierarchy,texture-size,geometry] [--time-limit DUR]",
                description:
                    "Search settings for a goal within a fidelity limit. Write <model>.<goal>.toon and an original | result PNG at the worst view. Does not write models; use run. Ties within 1% prefer higher fidelity, then smaller files.",
                flags: [
                    "--for size|gpu|load|compat[,...]: required goals",
                    "-o, --out DIR/|FILE.toon: default current directory; a file requires one input and one goal",
                    "--fidelity F: limit 0-1 (default 0.9)",
                    "--view PX: render size (default 1024)",
                    "--network slow-4g|4g|wifi: default 4g (9 Mbps)",
                    "--amortize N: split decoder downloads across N assets (default number of inputs)",
                    "--keep hierarchy,texture-size,geometry: disable hierarchy changes, downscaling or simplification",
                    "--time-limit DUR: whole-run budget, e.g. 90s, 5m (default 7m); partial results include a finish command",
                    "-h, --help",
                ],
                examples: [
                    "node-assets tune model.glb --for size -o graphs/",
                    "node-assets tune model.glb --for size,gpu --view 2048",
                    "node-assets tune assets/ --for load --network slow-4g --time-limit 5m",
                ],
            };
        case "help":
            return { usage: "node-assets help", description: "Print the node-assets manual.", flags: ["-h, --help"], examples: ["node-assets help", "node-assets run --help"] };
    }
}
