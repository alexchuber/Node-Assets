import { describe, expect, expectTypeOf, it } from "vitest";

import { CompressTexturesBlock, DracoEncoderBlock, GltfInputBlock, GltfOutputBlock, NodeAsset } from "../../src/index";
import { generateTexturedGltfDataUri } from "../fixtures/gltf";

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
        expect(parsed.json.meshes[0]?.primitives[0]?.extensions).toHaveProperty("KHR_draco_mesh_compression");
        expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
        expect(parsed.json.extensionsRequired).toContain("KHR_texture_basisu");
        const ktx2Image = parsed.json.images?.find(({ mimeType }) => mimeType === "image/ktx2");
        expect(ktx2Image).toBeDefined();

        const imageBufferViewIndex = ktx2Image?.bufferView;
        expect(imageBufferViewIndex).toBeTypeOf("number");
        const imageBufferView = parsed.json.bufferViews?.[imageBufferViewIndex as number];
        expect(imageBufferView).toBeDefined();
        const imageBytes = parsed.binary.subarray(imageBufferView?.byteOffset ?? 0, (imageBufferView?.byteOffset ?? 0) + (imageBufferView?.byteLength ?? 0));
        expect(imageBytes.subarray(0, KTX2_MAGIC.byteLength)).toEqual(KTX2_MAGIC);
    });
});

interface ParsedGlb {
    readonly json: {
        readonly extensionsRequired?: readonly string[];
        readonly extensionsUsed?: readonly string[];
        readonly images?: readonly { readonly bufferView?: number; readonly mimeType?: string }[];
        readonly bufferViews?: readonly { readonly byteLength: number; readonly byteOffset?: number }[];
        readonly meshes: ReadonlyArray<{
            readonly primitives: ReadonlyArray<{
                readonly extensions?: Readonly<Record<string, unknown>>;
            }>;
        }>;
    };
    readonly binary: Uint8Array;
}

async function parseGlbAsync(file: File): Promise<ParsedGlb> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);

    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim()) as ParsedGlb["json"];
    const binaryChunkOffset = 20 + jsonLength;
    expect(view.getUint32(binaryChunkOffset + 4, true)).toBe(0x004e4942);
    const binaryLength = view.getUint32(binaryChunkOffset, true);
    const binary = bytes.subarray(binaryChunkOffset + 8, binaryChunkOffset + 8 + binaryLength);
    return { json, binary };
}

const KTX2_MAGIC = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
