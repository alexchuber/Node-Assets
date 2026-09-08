import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";

import { Block } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType } from "../block/connectionPointType";

type CompressTexturesBlockDefinition = ReturnType<typeof createCompressTexturesBlockDefinition>;

let compressTexturesBlockDefinition: CompressTexturesBlockDefinition | undefined;

/** Compresses supported glTF-loaded PBR textures to KTX2. */
export class CompressTexturesBlock extends Block<CompressTexturesBlockDefinition> {
    public constructor() {
        super((compressTexturesBlockDefinition ??= createCompressTexturesBlockDefinition()));
    }
}

interface TextureReference {
    readonly texture: BaseTexture;
    replace(texture: BaseTexture): void;
}

function createCompressTexturesBlockDefinition() {
    return defineBlock({
        type: "transform.compress-textures",
        input: BabylonSceneType,
        output: BabylonSceneType,
        runAsync: compressTexturesAsync,
    });
}

async function compressTexturesAsync(scene: BabylonScene): Promise<BabylonScene> {
    const [{ PBRMaterial }, { Texture }, { GetCachedImageAsync }, { RegisterKHR_texture_basisu }] = await Promise.all([
        import("@babylonjs/core/Materials/PBR/pbrMaterial.js"),
        import("@babylonjs/core/Materials/Textures/texture.js"),
        import("@babylonjs/serializers/exportImageUtils.js"),
        import("@babylonjs/serializers/glTF/2.0/Extensions/KHR_texture_basisu.pure.js"),
        import("@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader.js"),
    ]);

    RegisterKHR_texture_basisu();

    const referencesByTexture = new Map<Texture, TextureReference[]>();
    for (const material of scene.materials) {
        if (!(material instanceof PBRMaterial)) {
            continue;
        }
        for (const reference of getTextureReferences(material)) {
            if (!(reference.texture instanceof Texture) || reference.texture.getClassName() !== "Texture") {
                continue;
            }
            const references = referencesByTexture.get(reference.texture);
            if (references === undefined) {
                referencesByTexture.set(reference.texture, [reference]);
            } else {
                references.push(reference);
            }
        }
    }

    for (const [sourceTexture, references] of referencesByTexture) {
        const cachedImage = await GetCachedImageAsync(sourceTexture);
        if (cachedImage === null) {
            throw new Error(`Texture "${sourceTexture.name}" does not have cached source image bytes.`);
        }

        const encoded = await encodeToKtx2Async(new Uint8Array(cachedImage.data));
        const compressedTexture = await createCompressedTextureAsync(Texture, scene, sourceTexture, encoded);
        for (const reference of references) {
            reference.replace(compressedTexture);
        }
        sourceTexture.dispose();
    }

    return scene;
}

function getTextureReferences(material: PBRMaterial): TextureReference[] {
    const references: TextureReference[] = [];
    addReference(
        references,
        () => material.albedoTexture,
        (texture) => (material.albedoTexture = texture)
    );
    addReference(
        references,
        () => material.ambientTexture,
        (texture) => (material.ambientTexture = texture)
    );
    addReference(
        references,
        () => material.emissiveTexture,
        (texture) => (material.emissiveTexture = texture)
    );
    addReference(
        references,
        () => material.reflectivityTexture,
        (texture) => (material.reflectivityTexture = texture)
    );
    addReference(
        references,
        () => material.metallicTexture,
        (texture) => (material.metallicTexture = texture)
    );
    addReference(
        references,
        () => material.metallicReflectanceTexture,
        (texture) => (material.metallicReflectanceTexture = texture)
    );
    addReference(
        references,
        () => material.microSurfaceTexture,
        (texture) => (material.microSurfaceTexture = texture)
    );
    addReference(
        references,
        () => material.bumpTexture,
        (texture) => (material.bumpTexture = texture)
    );
    return references;
}

function addReference(references: TextureReference[], get: () => BaseTexture | null, replace: (texture: BaseTexture) => void): void {
    const texture = get();
    if (texture !== null) {
        references.push({ texture, replace });
    }
}

async function encodeToKtx2Async(source: Uint8Array): Promise<Uint8Array> {
    const { encodeToKTX2 } = await import("babylonpress-ktx2-encoder");
    const options = {
        generateMipmap: true,
        isKTX2File: true,
        isUASTC: true,
    };

    if (!isNodeRuntime()) {
        return encodeToKTX2(source, options);
    }

    const { default: sharp } = await import("sharp");
    return encodeToKTX2(source, {
        ...options,
        imageDecoder: async (buffer) => {
            const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            return {
                data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                height: info.height,
                width: info.width,
            };
        },
    });
}

function isNodeRuntime(): boolean {
    return typeof process !== "undefined" && process.versions?.node !== undefined;
}

async function createCompressedTextureAsync(TextureConstructor: typeof Texture, scene: BabylonScene, source: Texture, encoded: Uint8Array): Promise<Texture> {
    const compressed = await new Promise<Texture>((resolve, reject) => {
        const texture = new TextureConstructor(
            `${source.name || "texture"}.ktx2`,
            scene,
            false,
            source.invertY,
            source.samplingMode,
            () => resolve(texture),
            (message, exception) => reject(exception ?? new Error(message ?? `Failed to load KTX2 texture "${source.name}".`)),
            encoded,
            false,
            undefined,
            "image/ktx2",
            undefined,
            undefined,
            ".ktx2"
        );
    });

    copyTextureProperties(source, compressed);
    return compressed;
}

function copyTextureProperties(source: Texture, destination: Texture): void {
    destination.name = source.name.endsWith(".ktx2") ? source.name : `${source.name}.ktx2`;
    destination.hasAlpha = source.hasAlpha;
    destination.getAlphaFromRGB = source.getAlphaFromRGB;
    destination.level = source.level;
    destination.coordinatesIndex = source.coordinatesIndex;
    destination.coordinatesMode = source.coordinatesMode;
    destination.wrapU = source.wrapU;
    destination.wrapV = source.wrapV;
    destination.wrapR = source.wrapR;
    destination.uOffset = source.uOffset;
    destination.vOffset = source.vOffset;
    destination.uScale = source.uScale;
    destination.vScale = source.vScale;
    destination.uAng = source.uAng;
    destination.vAng = source.vAng;
    destination.wAng = source.wAng;
    destination.uRotationCenter = source.uRotationCenter;
    destination.vRotationCenter = source.vRotationCenter;
    destination.wRotationCenter = source.wRotationCenter;
    destination.homogeneousRotationInUVTransform = source.homogeneousRotationInUVTransform;
    destination.anisotropicFilteringLevel = source.anisotropicFilteringLevel;
    destination.gammaSpace = source.gammaSpace;
}
