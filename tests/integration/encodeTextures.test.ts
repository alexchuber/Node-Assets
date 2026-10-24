import { Document } from "@gltf-transform/core";
import { EXTTextureAVIF, EXTTextureWebP, KHRMaterialsPBRSpecularGlossiness, KHRMaterialsSheen } from "@gltf-transform/extensions";
import sharp from "sharp";
import { expect, it } from "vitest";

import { EncodeTexturesBlock, GltfOutputBlock, NodeAsset } from "../../packages/core/src/index";
import { createRasterImageAsync } from "../helpers/document";
import { parseGlbAsync } from "../helpers/glb";

it.each(["webp", "avif", "jpeg", "png"] as const)("encodes PNG to %s, updates URIs, and never grows the image", async (format) => {
    const document = new Document();
    const image = await createRasterImageAsync();
    const texture = document.createTexture().setURI("textures/albedo.source.png?version=1").setMimeType("image/png").setImage(image);
    await new NodeAsset({ name: `encode-${format}`, outputBlock: new EncodeTexturesBlock({ input: document, format, quality: 60 }) }).executeAsync();
    expect(texture.getMimeType()).toBe(`image/${format}`);
    expect(texture.getURI()).toBe(`textures/albedo.source.${format}`);
    expect(texture.getImage()!.byteLength).toBeLessThanOrEqual(image.byteLength);
    expect((await sharp(texture.getImage()!).metadata()).format).toBe(format === "avif" ? "heif" : format);
    const used = document
        .getRoot()
        .listExtensionsRequired()
        .map((extension) => extension.extensionName);
    expect(used.includes("EXT_texture_webp")).toBe(format === "webp");
    expect(used.includes("EXT_texture_avif")).toBe(format === "avif");
});

it.each(["jpeg", "webp", "avif"] as const)("accepts %s sources and converts extension formats for compatibility even when larger", async (format) => {
    const document = new Document();
    const image = await createRasterImageAsync(format);
    const texture = document.createTexture().setURI("texture").setMimeType(`image/${format}`).setImage(image);
    if (format === "webp") {
        document.createExtension(EXTTextureWebP).setRequired(true);
    } else if (format === "avif") {
        document.createExtension(EXTTextureAVIF).setRequired(true);
    }
    await new NodeAsset({ name: "compatibility", outputBlock: new EncodeTexturesBlock({ input: document, format: "png" }) }).executeAsync();
    if (format === "jpeg") {
        expect(texture.getImage()!.byteLength).toBeLessThanOrEqual(image.byteLength);
    } else {
        expect(texture.getMimeType()).toBe("image/png");
        expect(texture.getURI()).toBe("texture.png");
        expect(texture.getImage()!.byteLength).toBeGreaterThan(image.byteLength);
    }
    expect(document.hasExtension("EXT_texture_webp")).toBe(false);
    expect(document.hasExtension("EXT_texture_avif")).toBe(false);
});

it("keeps alpha by falling back to PNG for JPEG targets", async () => {
    const document = new Document();
    const texture = document
        .createTexture()
        .setMimeType("image/png")
        .setURI("alpha.png")
        .setImage(await createRasterImageAsync("png", 16, 16, 100));
    await new NodeAsset({ name: "alpha", outputBlock: new EncodeTexturesBlock({ input: document, format: "jpeg" }) }).executeAsync();
    expect(texture.getMimeType()).toBe("image/png");
    const { data } = await sharp(texture.getImage()!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(100);
});

it("retains smaller originals, including their mime and URI", async () => {
    const document = new Document();
    const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } })
        .png()
        .toBuffer();
    const texture = document.createTexture().setMimeType("image/png").setURI("small.png").setImage(image);
    await new NodeAsset({ name: "keep-small", outputBlock: new EncodeTexturesBlock({ input: document, format: "avif" }) }).executeAsync();
    expect(texture.getImage()).toBe(image);
    expect(texture.getMimeType()).toBe("image/png");
    expect(texture.getURI()).toBe("small.png");
    expect(document.hasExtension("EXT_texture_avif")).toBe(false);
});

it("filters color/data slots, skips mixed textures, and includes unused textures only with all", async () => {
    const document = new Document();
    const image = await createRasterImageAsync();
    const textures = ["color", "data", "mixed", "unused", "specular"].map((name) => document.createTexture(name).setImage(image).setMimeType("image/png"));
    document.createMaterial().setBaseColorTexture(textures[0]!).setNormalTexture(textures[1]!);
    document.createMaterial().setEmissiveTexture(textures[2]!).setOcclusionTexture(textures[2]!);
    const extension = document.createExtension(KHRMaterialsPBRSpecularGlossiness);
    document.createMaterial().setExtension(extension.extensionName, extension.createPBRSpecularGlossiness().setSpecularGlossinessTexture(textures[4]!));
    await new NodeAsset({ name: "color-encoding", outputBlock: new EncodeTexturesBlock({ input: document, slots: "color" }) }).executeAsync();
    expect(textures.map((texture) => texture.getMimeType())).toEqual(["image/webp", "image/png", "image/png", "image/png", "image/webp"]);
    await new NodeAsset({ name: "data-encoding", outputBlock: new EncodeTexturesBlock({ input: document, slots: "data" }) }).executeAsync();
    expect(textures[1]!.getMimeType()).toBe("image/webp");
    expect(textures[2]!.getImage()).toBe(image);
    expect(textures[3]!.getImage()).toBe(image);
    await new NodeAsset({ name: "all-encoding", outputBlock: new EncodeTexturesBlock({ input: document }) }).executeAsync();
    expect(textures[2]!.getImage()).toBe(image);
    expect(textures[3]!.getMimeType()).toBe("image/webp");
});

it("treats sheen color textures as color rather than data", async () => {
    const document = new Document();
    const image = await createRasterImageAsync();
    const texture = document.createTexture().setImage(image).setMimeType("image/png");
    const extension = document.createExtension(KHRMaterialsSheen);
    document.createMaterial().setExtension(extension.extensionName, extension.createSheen().setSheenColorTexture(texture));

    await new NodeAsset({ name: "skip-sheen-data", outputBlock: new EncodeTexturesBlock({ input: document, slots: "data" }) }).executeAsync();
    expect(texture.getImage()).toBe(image);
    expect(texture.getMimeType()).toBe("image/png");

    await new NodeAsset({ name: "encode-sheen-color", outputBlock: new EncodeTexturesBlock({ input: document, slots: "color" }) }).executeAsync();
    expect(texture.getMimeType()).toBe("image/webp");
    expect(texture.getImage()!.byteLength).toBeLessThan(image.byteLength);
});

it.each(["webp", "avif", "jpeg"] as const)("passes %s quality through unchanged", async (format) => {
    const document = new Document();
    const image = await createRasterImageAsync();
    const texture = document.createTexture().setImage(image).setMimeType("image/png");
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = await sharp(data, { raw: { channels: 4, width: info.width, height: info.height } })
        .toFormat(format, { quality: 43 })
        .toBuffer();
    await new NodeAsset({ name: "quality", outputBlock: new EncodeTexturesBlock({ input: document, format, quality: 43 }) }).executeAsync();
    expect(texture.getImage()).toEqual(expected);
});

it("registers required texture extensions for connected GLB output", async () => {
    const document = new Document();
    document.createBuffer();
    document
        .createTexture()
        .setImage(await createRasterImageAsync())
        .setMimeType("image/png");
    const block = new EncodeTexturesBlock({ input: document });
    const output = new GltfOutputBlock();
    block.output.connectTo(output.input);
    const parsed = await parseGlbAsync(await new NodeAsset({ name: "encoded-output", outputBlock: output }).executeAsync());
    expect(parsed.json.images?.[0]?.mimeType).toBe("image/webp");
    expect(parsed.json.extensionsRequired).toContain("EXT_texture_webp");
});
