import { expect } from "vitest";

export const KTX2_MAGIC = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface GlbJson {
    readonly bufferViews?: ReadonlyArray<{ readonly byteLength: number; readonly byteOffset?: number }>;
    readonly extensionsRequired?: readonly string[];
    readonly extensionsUsed?: readonly string[];
    readonly images?: ReadonlyArray<{ readonly bufferView?: number; readonly mimeType?: string }>;
    readonly materials?: ReadonlyArray<{
        readonly pbrMetallicRoughness?: {
            readonly baseColorTexture?: {
                readonly extensions?: {
                    readonly KHR_texture_transform?: unknown;
                };
            };
        };
    }>;
    readonly meshes?: ReadonlyArray<{
        readonly primitives: ReadonlyArray<{
            readonly extensions?: Readonly<Record<string, unknown>>;
        }>;
    }>;
}

export interface ParsedGlb {
    readonly binary: Uint8Array;
    readonly json: GlbJson;
}

export async function parseGlbAsync(file: File): Promise<ParsedGlb> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("scene.glb");
    expect(file.type).toBe("model/gltf-binary");
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);

    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim()) as GlbJson;
    const binaryChunkOffset = 20 + jsonLength;
    expect(view.getUint32(binaryChunkOffset + 4, true)).toBe(0x004e4942);
    const binaryLength = view.getUint32(binaryChunkOffset, true);
    const binary = bytes.subarray(binaryChunkOffset + 8, binaryChunkOffset + 8 + binaryLength);

    return { binary, json };
}

export function getEmbeddedImageBytes(parsed: ParsedGlb, image: NonNullable<GlbJson["images"]>[number]): Uint8Array {
    expect(image.bufferView).toBeTypeOf("number");
    const bufferView = parsed.json.bufferViews?.[image.bufferView as number];
    expect(bufferView).toBeDefined();
    const offset = bufferView?.byteOffset ?? 0;
    return parsed.binary.subarray(offset, offset + (bufferView?.byteLength ?? 0));
}

export function expectKtx2Image(parsed: ParsedGlb): void {
    const image = parsed.json.images?.find(({ mimeType }) => mimeType === "image/ktx2");
    expect(image).toBeDefined();
    expect(getEmbeddedImageBytes(parsed, image as NonNullable<typeof image>).subarray(0, KTX2_MAGIC.byteLength)).toEqual(KTX2_MAGIC);
}
