import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build, defineConfig } from "vite";

export default defineConfig({
    root: fileURLToPath(new URL("./src/render/", import.meta.url)),
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
