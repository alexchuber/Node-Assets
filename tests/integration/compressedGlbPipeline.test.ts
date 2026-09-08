import { describe, expect, expectTypeOf, it } from "vitest";

import { CompressTexturesBlock, DracoEncoderBlock, GltfInputBlock, GltfOutputBlock, NodeAsset } from "../../src/index";
import { expectKtx2Image, parseGlbAsync } from "../helpers/glb";
import { generateTexturedGltfDataUri } from "../helpers/gltf";

describe("compressed GLB pipeline", () => {
    it("creates a Draco-compressed GLB with embedded KTX2 textures through the public API", async () => {
        const source = new GltfInputBlock({ input: generateTexturedGltfDataUri() });
        const compressTextures = new CompressTexturesBlock();
        const dracoEncoder = new DracoEncoderBlock();
        const destination = new GltfOutputBlock();

        source.output.connectTo(compressTextures.input);
        compressTextures.output.connectTo(destination.input);
        dracoEncoder.output.connectTo(destination.geometryCompressor);

        const asset = new NodeAsset({ name: "gltf-roundtrip", outputBlock: destination });
        const result = await asset.executeAsync();

        expectTypeOf(result).toEqualTypeOf<File>();
        expect(result).toBeInstanceOf(File);

        const parsed = await parseGlbAsync(result);
        expect(parsed.json.extensionsUsed).toContain("KHR_draco_mesh_compression");
        expect(parsed.json.meshes?.[0]?.primitives[0]?.extensions).toHaveProperty("KHR_draco_mesh_compression");
        expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
        expect(parsed.json.extensionsRequired).toContain("KHR_texture_basisu");
        expectKtx2Image(parsed);
    });
});
