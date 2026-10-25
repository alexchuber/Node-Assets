import { isBuiltin } from "node:module";
import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
    root: dirname(fileURLToPath(import.meta.url)),
    plugins: [
        {
            name: "bundled-node-assets-core",
            async writeBundle(options) {
                await cp(resolve(dirname(fileURLToPath(import.meta.url)), "../core/dist"), `${options.dir}/core`, { recursive: true });
            },
        },
    ],
    build: {
        target: "node20",
        minify: false,
        sourcemap: true,
        lib: {
            entry: { cli: "src/cli.ts", render: "src/render/index.ts" },
            formats: ["es"],
            fileName: (_format, name) => `${name}.js`,
        },
        rollupOptions: {
            external: (id) => isBuiltin(id) || (!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0")),
            output: {
                paths: { "@babylonjs/node-assets": "./core/index.js" },
            },
        },
    },
});
