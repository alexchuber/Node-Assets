import type { Scene } from "@babylonjs/core/scene";

import { describe, expect, expectTypeOf, it } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock } from "../../src/block/blockDefinition";
import { BabylonSceneType, FileType } from "../../src/block/connectionPointType";
import { GltfInputBlock, GltfOutputBlock, NodeAsset, NodeAssetContext } from "../../src/index";
import { generateGlbDataUri, generateGltfDataUri } from "../fixtures/gltf";

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
});

async function expectGlbFile(file: File): Promise<void> {
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("scene.glb");
    expect(file.type).toBe("model/gltf-binary");
    expect(file.size).toBeGreaterThan(12);

    const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    expect(new TextDecoder().decode(magic)).toBe("glTF");
}
