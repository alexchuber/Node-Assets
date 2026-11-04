import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, type Plugin } from "vite";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type * as NodeAssets from "../../packages/core/src/index";
import { parseGlbAsync } from "../helpers/glb";
import { generateGltfJson } from "../helpers/gltf";
import { withInputFilesAsync } from "../helpers/input";
import { generateMtlData, generateTexturedObjData, generateTextureData } from "../helpers/obj";

const ConsumerModuleId = "\0node-assets-browser-consumer";
const PublishedPackageName = "@babylonjs/node-assets";
const PublishedEntryPath = fileURLToPath(new URL("../../packages/core/dist/index.js", import.meta.url));

describe("browser consumer bundle", () => {
    beforeAll(buildLibrary, 120_000);

    it("bundles the published entry without resolving Node-only dependencies", async () => {
        const transformedModuleIds = new Set<string>();
        const result = await build({
            configFile: false,
            logLevel: "silent",
            plugins: [rejectNodeOnlyDependencies(), createConsumerPlugin(), trackTransformedModules(transformedModuleIds)],
            build: {
                assetsInlineLimit: 0,
                rollupOptions: {
                    input: "node-assets:browser-consumer",
                },
                write: false,
            },
        });
        if (Array.isArray(result) || !("output" in result)) {
            throw new Error("Expected one consumer bundle");
        }

        const fileNames = result.output.map(({ fileName }) => fileName);
        expect(transformedModuleIds).toContain(PublishedEntryPath);
        expect(fileNames.some((fileName) => /draco_decoder_gltf.*\.wasm$/.test(fileName))).toBe(true);
        expect(fileNames.some((fileName) => /draco_encoder.*\.wasm$/.test(fileName))).toBe(true);
        expect(fileNames.some((fileName) => /basis_encoder.*\.js$/.test(fileName))).toBe(true);
        expect(fileNames.some((fileName) => /basis_encoder.*\.wasm$/.test(fileName))).toBe(true);
        const chunks = new Map(result.output.filter((entry) => entry.type === "chunk").map((chunk) => [chunk.fileName, chunk]));
        const initialChunks = new Set([...chunks.values()].filter((chunk) => chunk.isEntry));
        for (const chunk of initialChunks) {
            expect(chunk.code.includes("xhr2")).toBe(false);
            for (const importedFile of chunk.imports) {
                const importedChunk = chunks.get(importedFile);
                if (importedChunk) {
                    initialChunks.add(importedChunk);
                }
            }
        }
    }, 120_000);

    it("tree-shakes KTX2 decoder code from an encoder-only published consumer", async () => {
        const transformedModuleIds = new Set<string>();
        const result = await build({
            configFile: false,
            logLevel: "silent",
            plugins: [rejectNodeOnlyDependencies(), createEncoderOnlyConsumerPlugin(), trackTransformedModules(transformedModuleIds)],
            build: {
                assetsInlineLimit: 0,
                rollupOptions: {
                    input: "node-assets:encoder-only-browser-consumer",
                },
                write: false,
            },
        });
        if (Array.isArray(result) || !("output" in result)) {
            throw new Error("Expected one consumer bundle");
        }

        const fileNames = result.output.map(({ fileName }) => fileName);
        const publishedFiles = await readdir(dirname(PublishedEntryPath));
        const encoderFactory = await readFile(new URL("../../node_modules/babylonpress-ktx2-encoder/dist/basis/basis_encoder.js", import.meta.url));
        const publishedScripts = await Promise.all(
            publishedFiles.filter((fileName) => fileName.endsWith(".js")).map((fileName) => readFile(resolve(dirname(PublishedEntryPath), fileName)))
        );
        expect(transformedModuleIds).toContain(PublishedEntryPath);
        expect(publishedScripts.some((script) => script.equals(encoderFactory))).toBe(false);
        expect(publishedFiles.some((fileName) => /basis_encoder.*\.wasm$/.test(fileName))).toBe(true);
        expect(fileNames.some((fileName) => /basis_encoder.*\.js$/.test(fileName))).toBe(true);
        expect(fileNames.some((fileName) => /basis_encoder.*\.wasm$/.test(fileName))).toBe(true);
        const chunks = result.output.filter((entry) => entry.type === "chunk");
        // Vite can emit unreferenced assets during module scanning; check the executable output graph.
        expect(chunks.some((chunk) => Object.keys(chunk.modules).some((id) => id.includes("babylonpress-ktx2-encoder")))).toBe(true);
        expect(chunks.some((chunk) => Object.keys(chunk.modules).some((id) => id.includes("ktx2Decoder") || id.includes("@babylonjs/ktx2decoder")))).toBe(false);
        expect(chunks.some((chunk) => chunk.dynamicImports.some((id) => /ktx2Decoder|msc-transcoder/.test(id)))).toBe(false);
    }, 120_000);

    it("tree-shakes unused Babylon scene loaders from an OBJ-only published consumer", async () => {
        const result = await build({
            configFile: false,
            logLevel: "silent",
            plugins: [rejectNodeOnlyDependencies(), createObjOnlyConsumerPlugin()],
            build: {
                assetsInlineLimit: 0,
                rollupOptions: {
                    input: "node-assets:obj-only-browser-consumer",
                },
                write: false,
            },
        });
        if (Array.isArray(result) || !("output" in result)) {
            throw new Error("Expected one consumer bundle");
        }

        const chunks = new Map(result.output.filter((entry) => entry.type === "chunk").map((chunk) => [chunk.fileName, chunk]));
        const executableChunks = new Set([...chunks.values()].filter((chunk) => chunk.isEntry));
        for (const chunk of executableChunks) {
            for (const importedFile of [...chunk.imports, ...chunk.dynamicImports]) {
                const importedChunk = chunks.get(importedFile);
                if (importedChunk) {
                    executableChunks.add(importedChunk);
                }
            }
        }

        const moduleIds = [...executableChunks].flatMap((chunk) => Object.keys(chunk.modules));
        expect(moduleIds.some((id) => id.includes("@babylonjs/loaders/OBJ/objFileLoader"))).toBe(true);
        expect(moduleIds.some((id) => id.includes("@babylonjs/loaders/FBX/fbxFileLoader"))).toBe(false);
        expect(moduleIds.some((id) => id.includes("@babylonjs/loaders/STL/stlFileLoader"))).toBe(false);
    }, 120_000);

    it("runs the published entry in Node", async () => {
        const url = "https://example.com/model.gltf";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateGltfJson())))
        );

        try {
            const { EncodeDracoBlock, GltfInputBlock, GltfOutputBlock, NodeAsset, ValidateBlock } = (await import(
                `${pathToFileURL(PublishedEntryPath).href}?test=${Date.now()}`
            )) as typeof NodeAssets;
            const source = new GltfInputBlock({ input: url });
            const encoder = new EncodeDracoBlock();
            const validate = new ValidateBlock();
            const destination = new GltfOutputBlock();
            source.output.connectTo(encoder.input);
            encoder.output.connectTo(validate.input);
            validate.output.connectTo(destination.input);

            await parseGlbAsync(await new NodeAsset({ name: "published-node-entry", outputBlock: destination }).executeAsync());
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("loads local OBJ dependencies through the published entry", async () => {
        const { NodeAsset, ObjInputBlock } = (await import(pathToFileURL(PublishedEntryPath).href)) as typeof NodeAssets;
        await withInputFilesAsync(
            {
                "model.obj": generateTexturedObjData("model.mtl"),
                "model.mtl": generateMtlData(),
                "textures/diffuse.png": generateTextureData(),
            },
            async (directory) => {
                const document = await new NodeAsset({ name: "published-obj", outputBlock: new ObjInputBlock({ input: join(directory, "model.obj") }) }).executeAsync();

                expect(document.getRoot().listMaterials()[0]?.getName()).toBe("Textured");
                expect(document.getRoot().listTextures()[0]?.getImage()).toEqual(generateTextureData());
            }
        );
    });
});

async function buildLibrary(): Promise<void> {
    await build({
        configFile: fileURLToPath(new URL("../../packages/core/vite.config.ts", import.meta.url)),
        logLevel: "silent",
    });
}

function createConsumerPlugin(): Plugin {
    return {
        name: "node-assets-browser-consumer",
        resolveId: (id) => (id === "node-assets:browser-consumer" ? ConsumerModuleId : undefined),
        load: (id) =>
            id === ConsumerModuleId
                ? `
                    import * as nodeAssets from ${JSON.stringify(PublishedPackageName)};
                    globalThis.nodeAssets = nodeAssets;
                `
                : undefined,
    };
}

function createEncoderOnlyConsumerPlugin(): Plugin {
    const moduleId = "\0node-assets-encoder-only-browser-consumer";
    return {
        name: "node-assets-encoder-only-browser-consumer",
        resolveId: (id) => (id === "node-assets:encoder-only-browser-consumer" ? moduleId : undefined),
        load: (id) =>
            id === moduleId
                ? `
                    import { EncodeKTX2Block } from ${JSON.stringify(PublishedPackageName)};
                    globalThis.EncodeKTX2Block = EncodeKTX2Block;
                `
                : undefined,
    };
}

function createObjOnlyConsumerPlugin(): Plugin {
    const moduleId = "\0node-assets-obj-only-browser-consumer";
    return {
        name: "node-assets-obj-only-browser-consumer",
        resolveId: (id) => (id === "node-assets:obj-only-browser-consumer" ? moduleId : undefined),
        load: (id) =>
            id === moduleId
                ? `
                    import { ObjInputBlock } from ${JSON.stringify(PublishedPackageName)};
                    globalThis.ObjInputBlock = ObjInputBlock;
                `
                : undefined,
    };
}

function rejectNodeOnlyDependencies(): Plugin {
    return {
        name: "node-assets-reject-node-only-dependencies",
        enforce: "pre",
        resolveId(id) {
            if (id === "sharp" || id === "xhr2") {
                throw new Error(`Browser consumer attempted to resolve ${id}`);
            }
        },
    };
}

function trackTransformedModules(moduleIds: Set<string>): Plugin {
    return {
        name: "node-assets-track-transformed-modules",
        transform(_code, id) {
            moduleIds.add(id);
        },
    };
}
