import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, defineConfig } from "vite";

export default defineConfig({
    root: resolve(dirname(fileURLToPath(import.meta.url)), "./src/render"),
    publicDir: false,
    plugins: [
        {
            name: "offline-ktx2-decoders",
            async generateBundle() {
                const require = createRequire(import.meta.url);
                const decoder = require.resolve("@babylonjs/ktx2decoder/index.js");
                const result = await build({
                    configFile: false,
                    publicDir: false,
                    logLevel: "error",
                    build: {
                        write: false,
                        minify: true,
                        lib: { entry: decoder, name: "KTX2DECODER", formats: ["iife"], fileName: () => "ktx2Decoder.js" },
                    },
                });
                for (const bundle of Array.isArray(result) ? result : [result]) {
                    if (!("output" in bundle)) throw new Error("KTX2 decoder build did not produce a bundle.");
                    for (const output of bundle.output) {
                        this.emitFile({ type: "asset", fileName: `codecs/${output.fileName}`, source: output.type === "chunk" ? output.code : output.source });
                    }
                }
                const root = dirname(decoder);
                for (const name of await readdir(join(root, "wasm"))) {
                    if (!/\.(wasm|js|md)$/.test(name)) continue;
                    this.emitFile({ type: "asset", fileName: `codecs/${name === "license.md" ? "wasm-license.md" : name}`, source: await readFile(join(root, "wasm", name)) });
                }
                for (const name of ["license.md", "NOTICE.md"]) {
                    this.emitFile({ type: "asset", fileName: `codecs/${name}`, source: await readFile(join(root, name)) });
                }
                for (const packageName of ["@babylonjs/core", "@babylonjs/loaders", "@babylonjs/ktx2decoder"]) {
                    const packageRoot = dirname(require.resolve(`${packageName}/package.json`));
                    for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
                        if (entry.isFile() && /^(license|notice)(?:[.-]|$)/i.test(entry.name)) {
                            this.emitFile({ type: "asset", fileName: `licenses/${packageName}/${entry.name}`, source: await readFile(join(packageRoot, entry.name)) });
                        }
                    }
                }
            },
        },
    ],
    build: {
        outDir: "../../dist/render",
        emptyOutDir: true,
        target: "es2022",
        chunkSizeWarningLimit: 2000,
    },
});
