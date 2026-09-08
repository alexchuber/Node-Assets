import type * as Ktx2Encoder from "babylonpress-ktx2-encoder";

import { describe, expect, it, vi } from "vitest";

import { CompressTexturesBlock } from "../../src/blocks/compressTexturesBlock";
import { GltfInputBlock } from "../../src/blocks/gltfInputBlock";
import { GltfOutputBlock } from "../../src/blocks/gltfOutputBlock";
import { NodeAsset } from "../../src/nodeAsset/nodeAsset";
import { generateMultiSamplerTexturedGltfDataUri } from "../fixtures/gltf";

const { encodeToKtx2Spy } = vi.hoisted(() => ({ encodeToKtx2Spy: vi.fn() }));

vi.mock("babylonpress-ktx2-encoder", async (importOriginal) => {
    const encoder = await importOriginal<typeof Ktx2Encoder>();
    return {
        ...encoder,
        encodeToKTX2: async (...parameters: Parameters<typeof encoder.encodeToKTX2>) => {
            encodeToKtx2Spy();
            return encoder.encodeToKTX2(...parameters);
        },
    };
});

describe("CompressTexturesBlock encoding", () => {
    it("encodes a shared source image once while preserving sampler-specific textures", async () => {
        const source = new GltfInputBlock({ input: generateMultiSamplerTexturedGltfDataUri() });
        const compressTextures = new CompressTexturesBlock();
        const destination = new GltfOutputBlock();

        source.output.connectTo(compressTextures.input);
        compressTextures.output.connectTo(destination.input);

        const result = await new NodeAsset({ name: "compress-shared-image", outputBlock: destination }).executeAsync();
        const parsed = await parseGlbAsync(result);

        expect(encodeToKtx2Spy).toHaveBeenCalledTimes(1);
        expect(parsed.materials[0]?.pbrMetallicRoughness?.baseColorTexture?.index).not.toBe(parsed.materials[0]?.emissiveTexture?.index);
        expect(parsed.textures).toHaveLength(2);
    });
});

interface ParsedGlb {
    readonly materials: ReadonlyArray<{
        readonly emissiveTexture?: { readonly index: number };
        readonly pbrMetallicRoughness?: { readonly baseColorTexture?: { readonly index: number } };
    }>;
    readonly textures: readonly unknown[];
}

async function parseGlbAsync(file: File): Promise<ParsedGlb> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim()) as ParsedGlb;
}
