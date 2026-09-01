import { describe, expect, it } from "vitest";

import { InputBlock, OutputBlock } from "../src/blocks/block";
import { defineInputBlock, defineOutputBlock } from "../src/blocks/blockDefinition";
import { GltfArtifactType, GltfBytesType } from "../src/gltfValues";
import { GlbOutputBlock, GltfInputBlock, NodeAsset, ParseGltfToBabylonBlock, SerializeBabylonToGltfBlock } from "../src/index";

const GltfBytesInputBlock = defineInputBlock({
    type: "gltf-bytes-input",
    input: GltfBytesType,
    output: GltfBytesType,
    run: (input) => input,
});

const GltfArtifactOutputBlock = defineOutputBlock({
    type: "gltf-artifact-output",
    input: GltfArtifactType,
    output: GltfArtifactType,
    run: (input) => input,
});

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

describe("GLTF pipeline", () => {
    it("parses GLTF bytes into Babylon and serializes them as GLB", async () => {
        const source = new GltfInputBlock({
            input: createGltfBytes(),
        });
        const destination = new GlbOutputBlock();

        expect(source.output.type).toBe(GltfArtifactType);
        source.output.connectTo(destination.input);

        const asset = new NodeAsset({ name: "gltf-to-glb", outputBlock: destination });
        const result = await asset.executeAsync();

        expect(new TextDecoder().decode(result.output.data.subarray(0, 4))).toBe("glTF");
        expect(result.output.fileName).toBe("scene.glb");

        const binarySource = new GltfInputBlock({ input: result.output.data });
        const binaryDestination = new GlbOutputBlock();
        binarySource.output.connectTo(binaryDestination.input);
        const binaryAsset = new NodeAsset({ name: "glb-to-glb", outputBlock: binaryDestination });
        const binaryResult = await binaryAsset.executeAsync();

        expect(new TextDecoder().decode(binaryResult.output.data.subarray(0, 4))).toBe("glTF");
    });

    it("executes the primitive parser and serializer blocks", async () => {
        const source = new InputBlock(GltfBytesInputBlock, { input: createGltfBytes() });
        const parser = new ParseGltfToBabylonBlock();
        const serializer = new SerializeBabylonToGltfBlock();
        const destination = new OutputBlock(GltfArtifactOutputBlock);
        source.output.connectTo(parser.input);
        parser.output.connectTo(serializer.input);
        serializer.output.connectTo(destination.input);

        const asset = new NodeAsset({ name: "primitive-gltf-roundtrip", outputBlock: destination });
        const result = await asset.executeAsync();

        expect(result.output.fileName).toBe("scene.gltf");
        expect(JSON.parse(new TextDecoder().decode(result.output.data))).toMatchObject({ asset: { version: "2.0" } });
    });
});
