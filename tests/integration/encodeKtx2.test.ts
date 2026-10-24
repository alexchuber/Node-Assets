import { Document } from "@gltf-transform/core";
import { EXTTextureWebP, KHRMaterialsPBRSpecularGlossiness } from "@gltf-transform/extensions";
import { describe, expect, it, vi } from "vitest";

import { EncodeKTX2Block, FbxInputBlock, GltfInputBlock, GltfOutputBlock, NodeAsset, ObjInputBlock } from "../../packages/core/src/index";
import { generateTexturedFbxDataWithUvs } from "../helpers/fbx";
import { expectKtx2Image, getTextureImageIndex, parseGlbAsync } from "../helpers/glb";
import { generateTexturedGltfJson } from "../helpers/gltf";
import { withHttpInputsAsync } from "../helpers/input";
import { generateMtlData, generateTexturedObjData, generateTextureData } from "../helpers/obj";
import { KTX2Encoder } from "../../packages/core/src/resources/ktx2Encoder";
import { NodeRasterImageCodec } from "../../packages/core/src/resources/nodeRasterImageCodec";
import { createRasterImageAsync } from "../helpers/document";

describe("KTX2 encoding", () => {
    it("retains legacy handling of specular/glossiness slots and AVIF inputs", async () => {
        const document = new Document();
        const extension = document.createExtension(KHRMaterialsPBRSpecularGlossiness);
        const texture = document.createTexture().setImage(generateTextureData()).setMimeType("image/png");
        document.createMaterial().setExtension(extension.extensionName, extension.createPBRSpecularGlossiness().setSpecularGlossinessTexture(texture));
        const image = await createRasterImageAsync("avif");
        const avif = document.createTexture().setImage(image).setMimeType("image/avif");
        await new NodeAsset({ name: "legacy-ktx2", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();
        expect(readKtx2Encoding(texture.getImage()!)).toEqual({ mode: 166, transfer: 1, supercompression: 2 });
        expect(avif.getImage()).toBe(image);
        expect(avif.getMimeType()).toBe("image/avif");
    });

    it("uses UASTC for color when requested and filters selected slots", async () => {
        const document = new Document();
        const image = generateTextureData();
        const color = document.createTexture().setImage(image).setMimeType("image/png");
        const data = document.createTexture().setImage(image).setMimeType("image/png");
        document.createMaterial().setBaseColorTexture(color).setOcclusionTexture(data);
        await new NodeAsset({ name: "color-uastc", outputBlock: new EncodeKTX2Block({ input: document, mode: "uastc", slots: "color", zstd: false }) }).executeAsync();
        expect(readKtx2Encoding(color.getImage()!)).toEqual({ mode: 166, transfer: 2, supercompression: 0 });
        expect(data.getImage()).toBe(image);
    });

    it.each(["color", "data"] as const)("preserves the previous %s encoding byte for byte with default config", async (usage) => {
        const document = new Document();
        const image = generateTextureData();
        const texture = document.createTexture().setMimeType("image/png").setImage(image);
        const material = document.createMaterial();
        if (usage === "color") {
            material.setBaseColorTexture(texture);
        } else {
            material.setOcclusionTexture(texture);
        }
        const codec = new NodeRasterImageCodec();
        try {
            const decoded = await codec.decodeAsync(image, "image/png");
            const color = usage === "color";
            const baseline = await new KTX2Encoder().encodeAsync(decoded, {
                ...(color ? {} : { isNormalMap: false }),
                isPerceptual: color,
                isSetKTX2SRGBTransferFunc: color,
                isUASTC: !color,
                useZstdSupercompression: !color,
            });
            await new NodeAsset({ name: "default-ktx2", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();
            expect(texture.getImage()).toEqual(baseline);
        } finally {
            await codec.disposeAsync();
        }
    });

    it("exports embedded KTX2 textures", async () => {
        const url = "https://example.com/model.gltf";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateTexturedGltfJson())))
        );

        try {
            const parsed = await parseGlbAsync(await encodeGltfAsync(url));

            expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
            expect(parsed.json.extensionsRequired).toContain("KHR_texture_basisu");
            expect(parsed.json.images?.every(({ mimeType }) => mimeType === "image/ktx2")).toBe(true);
            expectKtx2Image(parsed);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("accepts an already-compressed GLB", async () => {
        const sourceUrl = "https://example.com/model.gltf";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateTexturedGltfJson())))
        );
        const firstGlb = await encodeGltfAsync(sourceUrl);
        const encodedUrl = "https://example.com/model.glb";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => firstGlb.arrayBuffer().then((data) => new Response(data)))
        );

        try {
            const parsed = await parseGlbAsync(await encodeGltfAsync(encodedUrl));

            expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
            expect(parsed.json.images?.every(({ mimeType }) => mimeType === "image/ktx2")).toBe(true);
            expectKtx2Image(parsed);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("leaves a texture shared by color and normal slots unchanged", async () => {
        await withHttpInputsAsync(
            {
                "model.obj": generateTexturedObjData("model.mtl"),
                "model.mtl": generateMtlData(),
                "textures/diffuse.png": generateTextureData(),
            },
            async (rootUrl) => {
                const source = new ObjInputBlock({ input: `${rootUrl}model.obj` });
                const encoder = new EncodeKTX2Block();
                const destination = new GltfOutputBlock();
                source.output.connectTo(encoder.input);
                encoder.output.connectTo(destination.input);

                const parsed = await parseGlbAsync(await new NodeAsset({ name: "shared-texture-encoding", outputBlock: destination }).executeAsync());
                const material = parsed.json.materials?.[0];
                const colorImageIndex = getTextureImageIndex(parsed, material?.pbrMetallicRoughness?.baseColorTexture?.index);
                const normalImageIndex = getTextureImageIndex(parsed, material?.normalTexture?.index);

                expect(parsed.json.images).toHaveLength(1);
                expect(colorImageIndex).toBe(normalImageIndex);
                expect(parsed.json.images?.[0]?.mimeType).toBe("image/png");
                expect(parsed.json.extensionsUsed ?? []).not.toContain("KHR_texture_basisu");
            }
        );
    });

    it("encodes a texture from an FBX input", async () => {
        await withHttpInputsAsync({ "model.fbx": generateTexturedFbxDataWithUvs("textures/diffuse.png"), "textures/diffuse.png": generateTextureData() }, async (rootUrl) => {
            const source = new FbxInputBlock({ input: `${rootUrl}model.fbx` });
            const encoder = new EncodeKTX2Block();
            const destination = new GltfOutputBlock();
            source.output.connectTo(encoder.input);
            encoder.output.connectTo(destination.input);

            const parsed = await parseGlbAsync(await new NodeAsset({ name: "fbx-texture-encoding", outputBlock: destination }).executeAsync());

            expect(parsed.json.images).toHaveLength(1);
            expectKtx2Image(parsed);
        });
    });

    it("appends .ktx2 to extensionless texture URIs without collisions", async () => {
        const document = new Document();
        document.createTexture("albedo").setURI("albedo").setMimeType("image/png").setImage(generateTextureData());
        document.createTexture("normal").setURI("normal").setMimeType("image/png").setImage(generateTextureData());

        const result = await new NodeAsset({ name: "extensionless-texture-uris", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();

        expect(
            result
                .getRoot()
                .listTextures()
                .map((texture) => texture.getURI())
        ).toEqual(["albedo.ktx2", "normal.ktx2"]);
    });

    it.each([
        {
            name: "color",
            attach: (document: Document, texture: ReturnType<Document["createTexture"]>) => document.createMaterial().setBaseColorTexture(texture),
            expected: { mode: 163, transfer: 2, supercompression: 1 },
        },
        {
            name: "normal",
            attach: (document: Document, texture: ReturnType<Document["createTexture"]>) => document.createMaterial().setNormalTexture(texture),
            expected: { mode: 166, transfer: 1, supercompression: 2 },
        },
        {
            name: "data",
            attach: (document: Document, texture: ReturnType<Document["createTexture"]>) => document.createMaterial().setOcclusionTexture(texture),
            expected: { mode: 166, transfer: 1, supercompression: 2 },
        },
        {
            name: "unused",
            attach: () => {},
            expected: { mode: 166, transfer: 1, supercompression: 2 },
        },
    ])("infers $name texture encoding from usage", async ({ attach, expected }) => {
        const document = new Document();
        const texture = document.createTexture().setMimeType("image/png").setImage(generateTextureData());
        attach(document, texture);

        await new NodeAsset({ name: "inferred-ktx2-options", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();

        expect(readKtx2Encoding(texture.getImage()!)).toEqual(expected);
    });

    it("leaves a texture shared by normal and other data slots unchanged", async () => {
        const document = new Document();
        const image = generateTextureData();
        const texture = document.createTexture().setMimeType("image/png").setImage(image);
        const material = document.createMaterial().setNormalTexture(texture).setOcclusionTexture(texture);

        await new NodeAsset({ name: "conflicting-data-usage", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();

        expect(material.getNormalTexture()).toBe(texture);
        expect(material.getOcclusionTexture()).toBe(texture);
        expect(texture.getImage()).toEqual(image);
        expect(texture.getMimeType()).toBe("image/png");
    });

    it("removes the WebP extension after converting every WebP texture", async () => {
        const document = new Document();
        document.createExtension(EXTTextureWebP).setRequired(true);
        document.createTexture("albedo").setMimeType("image/webp").setImage(generateTextureData());

        const result = await new NodeAsset({ name: "remove-webp-extension", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();

        expect(result.hasExtension(EXTTextureWebP.EXTENSION_NAME)).toBe(false);
    });

    it("returns encoded texture bytes without retaining encoder scratch storage", async () => {
        const document = new Document();
        const texture = document.createTexture().setMimeType("image/png").setImage(generateTextureData());

        await new NodeAsset({ name: "tight-ktx2-output", outputBlock: new EncodeKTX2Block({ input: document }) }).executeAsync();

        const image = texture.getImage();
        expect(image).not.toBeNull();
        expect(image!.buffer.byteLength).toBe(image!.byteLength);
    });
});

async function encodeGltfAsync(input: string): Promise<File> {
    const source = new GltfInputBlock({ input });
    const encoder = new EncodeKTX2Block();
    const destination = new GltfOutputBlock();
    source.output.connectTo(encoder.input);
    encoder.output.connectTo(destination.input);
    return new NodeAsset({ name: "encode-ktx2", outputBlock: destination }).executeAsync();
}

function readKtx2Encoding(image: Uint8Array): { readonly mode: number; readonly transfer: number; readonly supercompression: number } {
    const header = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const dfdOffset = header.getUint32(48, true);
    return {
        mode: header.getUint8(dfdOffset + 12),
        transfer: header.getUint8(dfdOffset + 14),
        supercompression: header.getUint32(44, true),
    };
}
