import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

import { build, defineConfig } from "vite";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    publicDir: false,
    plugins: [
        {
            name: "dev-only-cold-load-page",
            async writeBundle() {
                await build({
                    configFile: false,
                    root: fileURLToPath(new URL("./dev/calibrate/", import.meta.url)),
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
