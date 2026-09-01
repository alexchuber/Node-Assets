import { describe, expect, it } from "vitest";

import { GltfInputBlock, GLBOutputBlock, NodeAsset, NodeAssetContext } from "../src/index";

function createGltfBytes(): Uint8Array {
    return new TextEncoder().encode(
        JSON.stringify({
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
        })
    );
}

describe("glTF pipeline", () => {
    it("loads GLTF into a Babylon scene and writes GLB", async () => {
        const source = new GltfInputBlock({ input: createGltfBytes() });
        const destination = new GLBOutputBlock();
        source.output.connectTo(destination.input);

        const asset = new NodeAsset({ name: "gltf-to-glb", outputBlock: destination });
        const result = await asset.executeAsync();

        expect(new TextDecoder().decode(result.output.subarray(0, 4))).toBe("glTF");
    });

    it("accepts GLTF through an execution context", async () => {
        const source = new GltfInputBlock();
        const destination = new GLBOutputBlock();
        source.output.connectTo(destination.input);
        const asset = new NodeAsset({ name: "context-gltf-to-glb", outputBlock: destination });
        const context = new NodeAssetContext(asset);
        context.setInput(source, createGltfBytes());

        const result = await asset.executeAsync(context);

        expect(result.output.byteLength).toBeGreaterThan(12);
    });

    it("accepts GLB input", async () => {
        const firstSource = new GltfInputBlock({ input: createGltfBytes() });
        const firstDestination = new GLBOutputBlock();
        firstSource.output.connectTo(firstDestination.input);
        const glb = (await new NodeAsset({ name: "create-glb", outputBlock: firstDestination }).executeAsync()).output;

        const source = new GltfInputBlock({ input: glb });
        const destination = new GLBOutputBlock();
        source.output.connectTo(destination.input);
        const result = await new NodeAsset({ name: "roundtrip-glb", outputBlock: destination }).executeAsync();

        expect(new TextDecoder().decode(result.output.subarray(0, 4))).toBe("glTF");
    });
});
