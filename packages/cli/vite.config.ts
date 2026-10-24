import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
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
            external: (id) =>
                isBuiltin(id) ||
                ["@babylonjs/node-assets", "@gltf-transform/core", "@gltf-transform/extensions", "draco3dgltf", "meshoptimizer", "playwright-core"].some(
                    (name) => id === name || id.startsWith(`${name}/`)
                ),
        },
    },
});
