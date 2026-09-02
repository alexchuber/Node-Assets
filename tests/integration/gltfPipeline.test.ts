import type { Scene } from "@babylonjs/core/scene";

import { describe, expect, expectTypeOf, it } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock } from "../../src/block/blockDefinition";
import { BabylonSceneType, FileType } from "../../src/block/connectionPointType";
import { GltfInputBlock, GltfOutputBlock, NodeAsset, NodeAssetContext } from "../../src/index";

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

        expectTypeOf(result.output).toEqualTypeOf<File>();
        await expectGlbFile(result.output);
    });

    it("accepts input through an execution context", async () => {
        const source = new GltfInputBlock();
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);

        const asset = new NodeAsset({ name: "context-gltf-to-glb", outputBlock: destination });

        const context = new NodeAssetContext(asset);
        context.setInput(source, generateGltfDataUri());

        const result = await asset.executeAsync(context);

        await expectGlbFile(result.output);
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

        await expectGlbFile(result.output);
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
            await expectGlbFile(result.output);
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

export function generateGltfDataUri(): string {
    return `data:${generateGltfJson()}`;
}

export function generateGlbDataUri(): string {
    const gltf = JSON.parse(generateGltfJson()) as {
        buffers: Array<{ byteLength: number; uri?: string }>;
    };

    const dataUri = gltf.buffers[0]?.uri;
    if (!dataUri) {
        throw new Error("Expected an embedded buffer");
    }

    const binary = Uint8Array.from(atob(dataUri.slice(dataUri.indexOf(",") + 1)), (character) => character.charCodeAt(0));
    delete gltf.buffers[0]?.uri;

    const json = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonLength = (json.byteLength + 3) & ~3;
    const binaryLength = (binary.byteLength + 3) & ~3;
    const binaryChunkOffset = 20 + jsonLength;
    const totalLength = binaryChunkOffset + 8 + binaryLength;

    const glb = new Uint8Array(totalLength);
    const header = new DataView(glb.buffer);

    header.setUint32(0, 0x46546c67, true); // glTF
    header.setUint32(4, 2, true);
    header.setUint32(8, totalLength, true);

    header.setUint32(12, jsonLength, true);
    header.setUint32(16, 0x4e4f534a, true); // JSON
    glb.set(json, 20);
    glb.fill(0x20, 20 + json.byteLength, binaryChunkOffset);

    header.setUint32(binaryChunkOffset, binaryLength, true);
    header.setUint32(binaryChunkOffset + 4, 0x004e4942, true); // BIN
    glb.set(binary, binaryChunkOffset + 8);

    return `data:model/gltf-binary;base64,${toBase64(glb)}`;
}

function generateGltfJson(): string {
    return JSON.stringify({
        asset: { version: "2.0" },
        buffers: [
            {
                byteLength: 78,
                uri: "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAABAAIA",
            },
        ],
        bufferViews: [
            { buffer: 0, byteLength: 36, byteOffset: 0 },
            { buffer: 0, byteLength: 36, byteOffset: 36 },
            { buffer: 0, byteLength: 6, byteOffset: 72 },
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, max: [1, 1, 0], min: [0, 0, 0], type: "VEC3" },
            { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        meshes: [{ primitives: [{ attributes: { NORMAL: 1, POSITION: 0 }, indices: 2 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
    });
}

function toBase64(data: Uint8Array): string {
    let binary = "";
    for (const byte of data) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
