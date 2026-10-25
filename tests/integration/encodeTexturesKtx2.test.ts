import { Document, NodeIO } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";
import sharp from "sharp";
import { expect, it } from "vitest";

import { EncodeTexturesBlock, GltfOutputBlock, NodeAsset } from "../../packages/core/src/index";
import { KTX2Decoder } from "../../packages/core/src/resources/ktx2Decoder";
import { KTX2Encoder } from "../../packages/core/src/resources/ktx2Encoder";

async function ktx2Image(mode: "etc1s" | "uastc", alpha: number): Promise<Uint8Array> {
    const data = new Uint8Array(32 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) data.set([x * 7, y * 15, (x + y) * 5, alpha], (y * 32 + x) * 4);
    return new KTX2Encoder().encodeAsync(
        { data, width: 32, height: 16 },
        {
            isUASTC: mode === "uastc",
            isPerceptual: true,
            isSetKTX2SRGBTransferFunc: true,
            etc1sQuality: 128,
            uastcQuality: 1,
            generateMipmaps: false,
            useZstdSupercompression: mode === "uastc",
        }
    );
}

it.each([
    ["etc1s", 255, "png"],
    ["uastc", 100, "jpeg"],
] as const)(
    "decodes %s KTX2 to PNG pixels for a %s-alpha %s target and removes BasisU",
    async (mode, alpha, format) => {
        const image = await ktx2Image(mode, alpha);
        const decoded = await new KTX2Decoder().decodeAsync(image);
        const doc = new Document();
        doc.createBuffer();
        doc.createExtension(KHRTextureBasisu).setRequired(true);
        const texture = doc.createTexture().setURI("textures/albedo.ktx2?version=1").setMimeType("image/ktx2").setImage(image);
        doc.createMaterial().setBaseColorTexture(texture);
        const encode = new EncodeTexturesBlock({ input: doc, format, slots: "color" });
        const output = new GltfOutputBlock();
        encode.output.connectTo(output.input);
        const asset = new NodeAsset({ name: "ktx2-compat", outputBlock: output });
        try {
            const glb = await asset.executeAsync();
            expect(texture.getMimeType()).toBe("image/png");
            expect(texture.getSize()).toEqual([32, 16]);
            expect(texture.getURI()).toBe("textures/albedo.png");
            expect(await sharp(texture.getImage()!).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(decoded.data));
            expect(doc.hasExtension("KHR_texture_basisu")).toBe(false);
            const roundTrip = await new NodeIO().readBinary(new Uint8Array(await glb.arrayBuffer()));
            expect(roundTrip.getRoot().listTextures()[0]!.getMimeType()).toBe("image/png");
            expect(roundTrip.getRoot().listExtensionsRequired()).toEqual([]);
        } finally {
            asset.dispose();
        }
    },
    30_000
);

it("filters KTX2 color/data/unused slots, preserves mixed images, and retains BasisU while needed", async () => {
    const image = await ktx2Image("uastc", 255);
    const doc = new Document();
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    const textures = ["color", "data", "mixed", "unused"].map((name) => doc.createTexture(name).setURI(`${name}.ktx2`).setMimeType("image/ktx2").setImage(image));
    doc.createMaterial().setBaseColorTexture(textures[0]!).setNormalTexture(textures[1]!);
    doc.createMaterial().setEmissiveTexture(textures[2]!).setOcclusionTexture(textures[2]!);

    await new NodeAsset({ name: "color", outputBlock: new EncodeTexturesBlock({ input: doc, format: "png", slots: "color" }) }).executeAsync();
    expect(textures.map((texture) => texture.getMimeType())).toEqual(["image/png", "image/ktx2", "image/ktx2", "image/ktx2"]);
    expect(doc.hasExtension("KHR_texture_basisu")).toBe(true);
    await new NodeAsset({ name: "data", outputBlock: new EncodeTexturesBlock({ input: doc, format: "png", slots: "data" }) }).executeAsync();
    expect(textures.map((texture) => texture.getMimeType())).toEqual(["image/png", "image/png", "image/ktx2", "image/ktx2"]);
    await new NodeAsset({ name: "all", outputBlock: new EncodeTexturesBlock({ input: doc, format: "png" }) }).executeAsync();
    expect(textures.map((texture) => texture.getMimeType())).toEqual(["image/png", "image/png", "image/ktx2", "image/png"]);
    expect(textures[2]!.getImage()).toBe(image);
    expect(textures[2]!.getURI()).toBe("mixed.ktx2");
    expect(
        doc
            .getRoot()
            .listExtensionsRequired()
            .map((extension) => extension.extensionName)
    ).toEqual(["KHR_texture_basisu"]);
}, 30_000);
