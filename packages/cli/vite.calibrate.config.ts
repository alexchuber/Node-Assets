import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, defineConfig } from "vite";

export default defineConfig({
    root: dirname(fileURLToPath(import.meta.url)),
    publicDir: false,
    plugins: [
        {
            name: "dev-only-cold-load-page",
            async writeBundle() {
                await build({
                    configFile: false,
                    root: resolve(dirname(fileURLToPath(import.meta.url)), "./dev/calibrate"),
                    publicDir: false,
                    build: {
                        outDir: "../../.dev/page",
                        emptyOutDir: true,
                        target: "es2022",
                        chunkSizeWarningLimit: 2000,
                    },
                });
            },
        },
    ],
    build: {
        outDir: ".dev",
        emptyOutDir: true,
        target: "node20",
        minify: false,
        sourcemap: true,
        lib: { entry: "dev/calibrate/main.ts", formats: ["es"], fileName: () => "calibrate.js" },
        rollupOptions: {
            external: (id) => isBuiltin(id) || (!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0")),
            output: { paths: { "@babylonjs/node-assets": "../dist/core/index.js" } },
        },
    },
});
