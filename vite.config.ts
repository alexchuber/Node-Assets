import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
    build: {
        target: "es2022",
        sourcemap: true,
        lib: {
            entry: "src/index.ts",
            formats: ["es"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            // Runtime and platform-specific dependencies are not bundled.
            external: [/^@babylonjs\//, /^babylonpress-ktx2-encoder$/, /^node:/, /^sharp$/],
        },
    },
    plugins: [
        dts({
            tsconfigPath: "./tsconfig.build.json",
            rollupTypes: true,
        }),
    ],
});
