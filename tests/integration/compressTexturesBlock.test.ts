import type { Scene } from "@babylonjs/core/scene.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";

import { describe, expect, it } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock } from "../../src/block/blockDefinition";
import { BabylonSceneType } from "../../src/block/connectionPointType";
import { CompressTexturesBlock, _getTextureEncodingSemantics } from "../../src/blocks/compressTexturesBlock";
import { GltfInputBlock } from "../../src/blocks/gltfInputBlock";
import { GltfOutputBlock } from "../../src/blocks/gltfOutputBlock";
import { NodeAsset } from "../../src/nodeAsset/nodeAsset";
import { generateTexturedGltfDataUri } from "../fixtures/gltf";

describe("CompressTexturesBlock", () => {
    it("replaces glTF textures with embedded KTX2 images without replacing the scene", async () => {
        let sceneBeforeCompression: Scene | undefined;
        let sceneAfterCompression: Scene | undefined;
        let sourceTexture: Texture | null | undefined;
        let compressedTexture: Texture | null | undefined;
        let sharedTextureIdentityWasPreserved = false;
        let nestedTextureIdentityWasPreserved = false;
        let normalTextureWasSeparated = false;
        let sourceTextureWasDisposed = false;
        const captureBefore = createSceneCaptureBlock((scene) => {
            sceneBeforeCompression = scene;
            const material = scene.materials[0] as PBRMaterial;
            sourceTexture = material.albedoTexture as Texture | null;
            if (sourceTexture !== null) {
                sourceTexture.name = "";
                sourceTexture.uOffset = 0.25;
                sourceTexture.vScale = 0.5;
                sourceTexture.gammaSpace = false;
                material.emissiveTexture = sourceTexture;
                material.bumpTexture = sourceTexture;
                material.clearCoat.texture = sourceTexture;
            }
        });
        const compressTextures = new CompressTexturesBlock();
        const captureAfter = createSceneCaptureBlock((scene) => {
            sceneAfterCompression = scene;
            const material = scene.materials[0] as PBRMaterial;
            compressedTexture = material.albedoTexture as Texture | null;
            sharedTextureIdentityWasPreserved = material.albedoTexture === material.emissiveTexture;
            nestedTextureIdentityWasPreserved = material.albedoTexture === material.clearCoat.texture;
            normalTextureWasSeparated = material.bumpTexture !== material.albedoTexture;
            sourceTextureWasDisposed = sourceTexture !== undefined && sourceTexture !== null && !scene.textures.includes(sourceTexture);
        });
        const source = new GltfInputBlock({ input: generateTexturedGltfDataUri() });
        const destination = new GltfOutputBlock();

        source.output.connectTo(captureBefore.input);
        captureBefore.output.connectTo(compressTextures.input);
        compressTextures.output.connectTo(captureAfter.input);
        captureAfter.output.connectTo(destination.input);

        const glb = await new NodeAsset({ name: "compress-textures", outputBlock: destination }).executeAsync();
        const parsed = await parseGlbAsync(glb);

        expect(sceneAfterCompression).toBe(sceneBeforeCompression);
        expect(compressedTexture).not.toBe(sourceTexture);
        expect(sharedTextureIdentityWasPreserved).toBe(true);
        expect(nestedTextureIdentityWasPreserved).toBe(true);
        expect(normalTextureWasSeparated).toBe(true);
        expect(sourceTextureWasDisposed).toBe(true);
        expect(compressedTexture?.name).toBe("texture.ktx2");
        expect(compressedTexture?.uOffset).toBe(0.25);
        expect(compressedTexture?.vScale).toBe(0.5);
        expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
        expect(parsed.json.extensionsRequired).toContain("KHR_texture_basisu");
        expect(parsed.json.images?.length).toBeGreaterThan(0);
        expect(parsed.json.images?.every(({ mimeType }) => mimeType === "image/ktx2")).toBe(true);

        const imageBufferViewIndex = parsed.json.images?.[0]?.bufferView;
        expect(imageBufferViewIndex).toBeTypeOf("number");
        const imageBufferView = parsed.json.bufferViews?.[imageBufferViewIndex as number];
        expect(imageBufferView).toBeDefined();
        const imageBytes = parsed.binary.subarray(imageBufferView?.byteOffset ?? 0, (imageBufferView?.byteOffset ?? 0) + (imageBufferView?.byteLength ?? 0));
        expect(imageBytes.subarray(0, KTX2_MAGIC.byteLength)).toEqual(KTX2_MAGIC);
    });

    it("selects linear normal-map encoding semantics from texture usage and gamma space", () => {
        expect(_getTextureEncodingSemantics(false, true)).toEqual({
            isNormalMap: true,
            isPerceptual: false,
            isSetKTX2SRGBTransferFunc: false,
        });
        expect(_getTextureEncodingSemantics(true, false)).toEqual({
            isNormalMap: false,
            isPerceptual: true,
            isSetKTX2SRGBTransferFunc: true,
        });
    });

    it("can compress an already compressed GLB again", async () => {
        const firstGlb = await compressGltfAsync(generateTexturedGltfDataUri());
        const secondGlb = await compressGltfAsync(`data:model/gltf-binary;base64,${toBase64(new Uint8Array(await firstGlb.arrayBuffer()))}`);
        const parsed = await parseGlbAsync(secondGlb);

        expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
        expect(parsed.json.extensionsRequired).toContain("KHR_texture_basisu");
        expect(parsed.json.images?.length).toBeGreaterThan(0);
        expect(parsed.json.images?.every(({ mimeType }) => mimeType === "image/ktx2")).toBe(true);

        const imageBufferViewIndex = parsed.json.images?.[0]?.bufferView;
        expect(imageBufferViewIndex).toBeTypeOf("number");
        const imageBufferView = parsed.json.bufferViews?.[imageBufferViewIndex as number];
        expect(imageBufferView).toBeDefined();
        const imageBytes = parsed.binary.subarray(imageBufferView?.byteOffset ?? 0, (imageBufferView?.byteOffset ?? 0) + (imageBufferView?.byteLength ?? 0));
        expect(imageBytes.subarray(0, KTX2_MAGIC.byteLength)).toEqual(KTX2_MAGIC);
    });
});

async function compressGltfAsync(input: string): Promise<File> {
    const source = new GltfInputBlock({ input });
    const compressTextures = new CompressTexturesBlock();
    const destination = new GltfOutputBlock();

    source.output.connectTo(compressTextures.input);
    compressTextures.output.connectTo(destination.input);

    return new NodeAsset({ name: "compress-textures", outputBlock: destination }).executeAsync();
}

function createSceneCaptureBlock(capture: (scene: Scene) => void): Block<ReturnType<typeof createSceneCaptureDefinition>> {
    return new Block(createSceneCaptureDefinition(capture));
}

function createSceneCaptureDefinition(capture: (scene: Scene) => void) {
    return defineBlock({
        type: "capture-scene",
        input: BabylonSceneType,
        output: BabylonSceneType,
        run: (scene) => {
            capture(scene);
            return scene;
        },
    });
}

interface ParsedGlb {
    readonly json: {
        readonly extensionsRequired?: readonly string[];
        readonly extensionsUsed?: readonly string[];
        readonly images?: readonly { readonly bufferView?: number; readonly mimeType?: string }[];
        readonly bufferViews?: readonly { readonly byteLength: number; readonly byteOffset?: number }[];
    };
    readonly binary: Uint8Array;
}

async function parseGlbAsync(file: File): Promise<ParsedGlb> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);

    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as ParsedGlb["json"];
    const binaryChunkOffset = 20 + jsonLength;
    const binaryLength = view.getUint32(binaryChunkOffset, true);
    const binary = bytes.subarray(binaryChunkOffset + 8, binaryChunkOffset + 8 + binaryLength);
    return { json, binary };
}

const KTX2_MAGIC = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

function toBase64(data: Uint8Array): string {
    let binary = "";
    for (const byte of data) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
