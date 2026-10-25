import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

import { decode } from "@toon-format/toon";

import { builtinPath } from "../graphFiles";
import { supportedInput } from "../inputs";
import { out, rel } from "../output";

export async function home(): Promise<number> {
    const models: { file: string; bytes: number }[] = [];
    const graphs: { file: string; bytes: number }[] = [];
    async function walk(directory: string, depth: number): Promise<void> {
        if (depth > 3) return;
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) continue;
            const file = join(directory, entry.name);
            if (entry.isDirectory()) await walk(file, depth + 1);
            else if (entry.isFile()) {
                if (supportedInput(file)) models.push({ file: rel(file), bytes: (await stat(file)).size });
                else if (extname(file) === ".toon") {
                    try {
                        const value = decode(await readFile(file, "utf8"));
                        if (value && typeof value === "object" && !Array.isArray(value) && "graph" in value && value.graph === 1)
                            graphs.push({ file: rel(file), bytes: (await stat(file)).size });
                    } catch {
                        // Other TOON documents are not graph files.
                    }
                }
            }
        }
    }
    await walk(process.cwd(), 0);
    models.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
    graphs.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
    const executable = resolve(process.argv[1] ?? "node-assets");
    const home = homedir();
    out({
        bin: executable.startsWith(home + "/") ? "~" + executable.slice(home.length) : executable,
        description: "Make 3D models small and web-ready: inspect models, tune a graph for size, gpu, load or compat, and run graphs",
        models: models.length ? models : "0 models found under the current directory",
        graphs: graphs.length ? graphs : "0 graphs found under the current directory",
        builtins: [{ name: "optimize", file: builtinPath(), description: "WebP up to 2048 px (color q90, data q95), quantized geometry, lossless cleanup" }],
        help: [
            "node-assets inspect <file|dir>: size, GPU memory, load time and decoders",
            "node-assets tune <input> --for size|gpu|load|compat -o graphs/: search for a goal within a fidelity limit",
            "node-assets run optimize <input> -o <out.glb|dir/>: apply the built-in graph",
            "node-assets show optimize: print every block setting",
            "node-assets <command> --help: flags and examples; node-assets help: full manual",
        ],
    });
    return 0;
}
