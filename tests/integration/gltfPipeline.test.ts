import type { Scene } from "@babylonjs/core/scene";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock } from "../../src/block/blockDefinition";
import { BabylonSceneType, FileType } from "../../src/block/connectionPointType";
import { GltfInputBlock, GltfOutputBlock, NodeAsset, NodeAssetContext } from "../../src/index";
import { generateGlbDataUri, generateGltfDataUri, generateTexturedGltfDataUri } from "../fixtures/gltf";

describe("glTF pipeline", () => {
    it.each([
        { in: "gltf", source: "uri", input: generateGltfDataUri() },
        { in: "glb", source: "uri", input: generateGlbDataUri() },
        { in: "glb", source: "url", input: "https://assets.babylonjs.com/meshes/box.glb" },
        { in: "gltf", source: "url", input: "https://assets.babylonjs.com/meshes/BoomBox/BoomBox.gltf" },
    ])("accepts $in input from $source", async ({ in: formatIn, input }) => {
        const sourceBlock = new GltfInputBlock({ input });
        const destination = new GltfOutputBlock();
        sourceBlock.output.connectTo(destination.input);

        const asset = new NodeAsset({ name: `roundtrip-${formatIn}`, outputBlock: destination });
        const result = await asset.executeAsync();

        expectTypeOf(result).toEqualTypeOf<File>();
        await expectGlbFile(result);
    });

    it("accepts input through an execution context", async () => {
        const source = new GltfInputBlock();
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);

        const asset = new NodeAsset({ name: "context-gltf-to-glb", outputBlock: destination });

        const context = new NodeAssetContext(asset);
        context.setInput(source, generateGltfDataUri());

        const result = await asset.executeAsync(context);

        await expectGlbFile(result);
    });

    it("accepts extensionless HTTP GLB inputs", async () => {
        const input = "https://example.com/model";
        const encodedGlb = generateGlbDataUri().split(",", 2)[1];
        if (encodedGlb === undefined) {
            throw new Error("Expected an encoded GLB fixture.");
        }
        const glb = Uint8Array.from(atob(encodedGlb), (character) => character.charCodeAt(0));
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(glb, { headers: { "content-type": "model/gltf-binary" } })))
        );

        try {
            const source = new GltfInputBlock({ input });
            const destination = new GltfOutputBlock();
            source.output.connectTo(destination.input);

            const result = await new NodeAsset({ name: "extensionless-http-glb", outputBlock: destination }).executeAsync();

            await expectGlbFile(result);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("disposes intermediate scenes and engines after conversion", async () => {
        let capturedScene: Scene | undefined;
        const captureSceneDefinition = defineBlock({
            type: "capture-scene",
            input: BabylonSceneType,
            output: BabylonSceneType,
            run: (scene) => {
                capturedScene = scene;
                return scene;
            },
        });
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const capture = new Block(captureSceneDefinition);
        const destination = new GltfOutputBlock();
        source.output.connectTo(capture.input);
        capture.output.connectTo(destination.input);

        const result = await new NodeAsset({ name: "resource-cleanup", outputBlock: destination }).executeAsync();
        const scene = capturedScene;
        if (scene === undefined) {
            throw new Error("Expected the capture block to receive a scene.");
        }

        await expectGlbFile(result);
        expect(scene.isDisposed).toBe(true);
        expect(scene.getEngine().isDisposed).toBe(true);
    });

    it("disposes scenes and engines when downstream conversion fails", async () => {
        let capturedScene: Scene | undefined;
        const failingDefinition = defineBlock({
            type: "failing-scene-output",
            input: BabylonSceneType,
            output: FileType,
            run: (scene) => {
                capturedScene = scene;
                throw new Error("conversion failed");
            },
        });
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const destination = new Block(failingDefinition);
        source.output.connectTo(destination.input);
        const asset = new NodeAsset({ name: "failed-resource-cleanup", outputBlock: destination });

        await expect(asset.executeAsync()).rejects.toThrow();
        const scene = capturedScene;
        if (scene === undefined) {
            throw new Error("Expected the failing block to receive a scene.");
        }

        expect(scene.isDisposed).toBe(true);
        expect(scene.getEngine().isDisposed).toBe(true);
    });

    it("isolates engines between concurrent conversions", async () => {
        const capturedScenes: Scene[] = [];
        const captureSceneDefinition = defineBlock({
            type: "capture-concurrent-scenes",
            input: BabylonSceneType,
            output: BabylonSceneType,
            run: (scene) => {
                capturedScenes.push(scene);
                return scene;
            },
        });
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const capture = new Block(captureSceneDefinition);
        const destination = new GltfOutputBlock();
        source.output.connectTo(capture.input);
        capture.output.connectTo(destination.input);
        const asset = new NodeAsset({ name: "concurrent-resource-cleanup", outputBlock: destination });

        const results = await Promise.all([asset.executeAsync(), asset.executeAsync()]);

        expect(capturedScenes).toHaveLength(2);
        expect(capturedScenes[0]?.getEngine()).not.toBe(capturedScenes[1]?.getEngine());
        for (const scene of capturedScenes) {
            expect(scene.isDisposed).toBe(true);
            expect(scene.getEngine().isDisposed).toBe(true);
        }
        for (const result of results) {
            await expectGlbFile(result);
        }
    });

    it("preserves texture transforms when exporting GLB", async () => {
        const transformDefinition = defineBlock({
            type: "transform-texture",
            input: BabylonSceneType,
            output: BabylonSceneType,
            run: (scene) => {
                const texture = (scene.materials[0] as PBRMaterial).albedoTexture as Texture;
                texture.uOffset = 0.25;
                texture.vOffset = 0.5;
                texture.uScale = 0.75;
                texture.vScale = 0.625;
                texture.wAng = 0.125;
                texture.uRotationCenter = 0;
                texture.vRotationCenter = 0;
                texture.coordinatesIndex = 1;
                return scene;
            },
        });
        const source = new GltfInputBlock({ input: generateTexturedGltfDataUri() });
        const transform = new Block(transformDefinition);
        const destination = new GltfOutputBlock();
        source.output.connectTo(transform.input);
        transform.output.connectTo(destination.input);

        const result = await new NodeAsset({ name: "texture-transform", outputBlock: destination }).executeAsync();
        const gltf = await readGlbJsonAsync(result);
        const textureTransform = gltf.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;

        expect(gltf.extensionsUsed).toContain("KHR_texture_transform");
        expect(textureTransform).toEqual({
            offset: [0.25, 0.5],
            rotation: -0.125,
            scale: [0.75, 0.625],
            texCoord: 1,
        });
    });

    it("aborts sibling HTTP dependency fetches after a dependency fails", async () => {
        const rootUrl = "https://example.com/model.gltf";
        const gltf = JSON.parse(generateGltfDataUri().slice("data:".length)) as {
            buffers: Array<{ byteLength: number; uri: string }>;
            bufferViews: Array<{ buffer: number; byteLength: number; byteOffset: number }>;
        };
        gltf.buffers = [
            { byteLength: 72, uri: "slow.bin" },
            { byteLength: 6, uri: "fail.bin" },
        ];
        gltf.bufferViews[2] = { buffer: 1, byteLength: 6, byteOffset: 0 };
        let slowFetchWasAborted = false;
        const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url === rootUrl) {
                return Promise.resolve(new Response(JSON.stringify(gltf), { headers: { "content-type": "model/gltf+json" } }));
            }
            if (url.endsWith("/fail.bin")) {
                return Promise.resolve(new Response("", { status: 500, statusText: "Failed" }));
            }
            if (url.endsWith("/slow.bin")) {
                return new Promise<Response>((_resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error("slow dependency was not aborted")), 100);
                    init?.signal?.addEventListener(
                        "abort",
                        () => {
                            clearTimeout(timeout);
                            slowFetchWasAborted = true;
                            reject(init.signal?.reason);
                        },
                        { once: true }
                    );
                });
            }
            return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        });
        vi.stubGlobal("fetch", fetchMock);

        try {
            const source = new GltfInputBlock({ input: rootUrl });
            await expect(new NodeAsset({ name: "failed-http-gltf", outputBlock: source }).executeAsync()).rejects.toThrow();
            expect(slowFetchWasAborted).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

async function expectGlbFile(file: File): Promise<void> {
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("scene.glb");
    expect(file.type).toBe("model/gltf-binary");
    expect(file.size).toBeGreaterThan(12);

    const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    expect(new TextDecoder().decode(magic)).toBe("glTF");
}

interface GltfJson {
    readonly extensionsUsed?: readonly string[];
    readonly materials?: ReadonlyArray<{
        readonly pbrMetallicRoughness?: {
            readonly baseColorTexture?: {
                readonly extensions?: {
                    readonly KHR_texture_transform?: unknown;
                };
            };
        };
    }>;
}

async function readGlbJsonAsync(file: File): Promise<GltfJson> {
    const data = await file.arrayBuffer();
    const view = new DataView(data);
    const jsonLength = view.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength)).trim()) as GltfJson;
}
