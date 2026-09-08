import type { DracoEncoder as BabylonDracoEncoder } from "@babylonjs/core/Meshes/Compression/dracoEncoder.js";

import { describe, expect, expectTypeOf, it } from "vitest";

import { DracoEncoderBlock, GltfInputBlock, GltfOutputBlock, NodeAsset } from "../../src/index";
import { parseGlbAsync } from "../helpers/glb";
import { generateGltfDataUri } from "../helpers/gltf";

describe("Draco compression", () => {
    it("leaves unconnected glTF output uncompressed", async () => {
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);

        const result = await new NodeAsset({ name: "uncompressed-glb", outputBlock: destination }).executeAsync();
        const { json } = await parseGlbAsync(result);

        expect(json.extensionsUsed ?? []).not.toContain("KHR_draco_mesh_compression");
        expect(json.meshes?.[0]?.primitives[0]?.extensions?.KHR_draco_mesh_compression).toBeUndefined();
    });

    it("compresses concurrent connected glTF outputs", async () => {
        const assets = ["first", "second"].map((name) => {
            const source = new GltfInputBlock({ input: generateGltfDataUri() });
            const encoder = new DracoEncoderBlock();
            const destination = new GltfOutputBlock();
            source.output.connectTo(destination.input);
            encoder.output.connectTo(destination.geometryCompressor);
            return new NodeAsset({ name: `draco-compressed-${name}-glb`, outputBlock: destination });
        });

        const results = await Promise.all(assets.map((asset) => asset.executeAsync()));
        for (const result of results) {
            const { json } = await parseGlbAsync(result);
            expect(json.extensionsUsed).toContain("KHR_draco_mesh_compression");
            expect(json.meshes?.[0]?.primitives[0]?.extensions).toHaveProperty("KHR_draco_mesh_compression");
        }
    });

    it("provides Babylon's default Draco encoder", async () => {
        const encoderBlock = new DracoEncoderBlock();
        const result = await new NodeAsset({ name: "draco-encoder", outputBlock: encoderBlock }).executeAsync();
        const { DracoEncoder } = await import("@babylonjs/core/Meshes/Compression/dracoEncoder.js");

        expectTypeOf(result).toEqualTypeOf<BabylonDracoEncoder>();
        expect(result).toBe(DracoEncoder.Default);
    });
});
