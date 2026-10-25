import { Document } from "@gltf-transform/core";
import sharp from "sharp";
import { expect, it } from "vitest";

import { EncodeTexturesBlock, NodeAsset, ResizeTexturesBlock } from "../../packages/core/src/index";
import { createRasterImageAsync } from "../helpers/document";

it.each(["png", "jpeg", "webp", "avif"] as const)("resizes %s without changing format or upscaling", async (format) => {
    const document = new Document();
    const image = await createRasterImageAsync(format, 32, 16);
    const texture = document.createTexture().setURI(`texture.${format}`).setMimeType(`image/${format}`).setImage(image);
    await new NodeAsset({ name: "resize", outputBlock: new ResizeTexturesBlock({ input: document, maxSize: 8 }) }).executeAsync();
    const metadata = await sharp(texture.getImage()!).metadata();
    expect([metadata.width, metadata.height]).toEqual([8, 4]);
    expect(metadata.format).toBe(format === "avif" ? "heif" : format);
    expect(texture.getMimeType()).toBe(`image/${format}`);
    expect(texture.getURI()).toBe(`texture.${format}`);
    const resized = texture.getImage();
    await new NodeAsset({ name: "no-upscale", outputBlock: new ResizeTexturesBlock({ input: document, maxSize: 16 }) }).executeAsync();
    expect(texture.getImage()).toBe(resized);
});

it("caps a 4096x8 AVIF at 2048 pixels before WebP encoding", async () => {
    const document = new Document();
    const texture = document
        .createTexture()
        .setURI("wide.avif")
        .setMimeType("image/avif")
        .setImage(await createRasterImageAsync("avif", 4096, 8));
    document.createMaterial().setBaseColorTexture(texture);
    const resize = new ResizeTexturesBlock({ input: document, maxSize: 2048 });
    const encode = new EncodeTexturesBlock({ format: "webp", slots: "color" });
    resize.output.connectTo(encode.input);
    await new NodeAsset({ name: "resize-avif-before-encoding", outputBlock: encode }).executeAsync();
    const metadata = await sharp(texture.getImage()!).metadata();
    expect([metadata.width, metadata.height]).toEqual([2048, 4]);
});

it("filters slots, skips mixed textures, and includes unused textures only with all", async () => {
    const document = new Document();
    const image = await createRasterImageAsync();
    const textures = ["color", "data", "mixed", "unused"].map((name) => document.createTexture(name).setMimeType("image/png").setImage(image));
    document.createMaterial().setBaseColorTexture(textures[0]!).setNormalTexture(textures[1]!);
    document.createMaterial().setBaseColorTexture(textures[2]!).setOcclusionTexture(textures[2]!);
    await new NodeAsset({ name: "color-resize", outputBlock: new ResizeTexturesBlock({ input: document, maxSize: 8, slots: "color" }) }).executeAsync();
    expect((await sharp(textures[0]!.getImage()!).metadata()).width).toBe(8);
    expect(textures.slice(1).every((texture) => texture.getImage() === image)).toBe(true);
    await new NodeAsset({ name: "all-resize", outputBlock: new ResizeTexturesBlock({ input: document, maxSize: 8 }) }).executeAsync();
    expect(textures[2]!.getImage()).toBe(image);
    expect((await sharp(textures[1]!.getImage()!).metadata()).width).toBe(8);
    expect((await sharp(textures[3]!.getImage()!).metadata()).width).toBe(8);
});
