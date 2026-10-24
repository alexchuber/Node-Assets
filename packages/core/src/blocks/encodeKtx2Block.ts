import type { Document } from "@gltf-transform/core";
import { EXTTextureWebP, KHRTextureBasisu } from "@gltf-transform/extensions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { classifyTexture, matchesTextureSlots, type TextureSlots } from "../helpers/textureUsage";
import { updateTextureUri } from "../helpers/updateTextureUri";
import type { KTX2EncodeOptions, KTX2Encoder } from "../resources/ktx2Encoder";
import { KTX2EncoderResource } from "../resources/ktx2EncoderResource";
import { PlatformIOResource } from "../resources/platformIOResource";
import { isRasterImageMimeType, type RasterImageCodec } from "../resources/rasterImageCodec";
import { RasterImageCodecResource } from "../resources/rasterImageCodecResource";
import { Block, type BlockOptions } from "./block";
import { booleanValue, defineBlock, enumValue, integerValue } from "./blockDefinition";

const EncodeKtx2BlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.encode-ktx2",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: {
        mode: enumValue(["auto", "etc1s", "uastc"]),
        slots: enumValue(["all", "color", "data"]),
        etc1sQuality: integerValue(150, { min: 1, max: 255 }),
        uastcQuality: integerValue(2, { min: 0, max: 4 }),
        zstd: booleanValue(true),
    },
    resources: {
        io: PlatformIOResource,
        ktx2Encoder: KTX2EncoderResource,
        rasterImageCodec: RasterImageCodecResource,
    },
    runAsync: async (document, config, { io, ktx2Encoder, rasterImageCodec }) => {
        io.registerExtensions([KHRTextureBasisu]);
        return encodeKtx2Async(document, config, rasterImageCodec, ktx2Encoder);
    },
});

/** Options for KTX2 encoding mode, quality, supercompression, and texture selection. */
export type EncodeKTX2BlockOptions = BlockOptions<typeof EncodeKtx2BlockDefinition>;

/** Encodes compatible document textures as KTX2. */
export class EncodeKTX2Block extends Block<typeof EncodeKtx2BlockDefinition> {
    public constructor(options?: EncodeKTX2BlockOptions) {
        super(EncodeKtx2BlockDefinition, options);
    }
}

async function encodeKtx2Async(
    document: Document,
    config: { readonly mode: "auto" | "etc1s" | "uastc"; readonly slots: TextureSlots; readonly etc1sQuality: number; readonly uastcQuality: number; readonly zstd: boolean },
    rasterImageCodec: RasterImageCodec,
    ktx2Encoder: KTX2Encoder
): Promise<Document> {
    let encodedTexture = false;

    await Promise.all(
        document
            .getRoot()
            .listTextures()
            .map(async (texture) => {
                const image = texture.getImage();
                const mimeType = texture.getMimeType();
                if (image === null || mimeType === "image/avif" || !isRasterImageMimeType(mimeType)) {
                    return;
                }

                const usage = classifyTexture(texture, /color|emissive|diffuse/i);
                if (!matchesTextureSlots(usage.category, config.slots) || (usage.normal && usage.otherData)) {
                    return;
                }
                const isColor = usage.category === "color";
                const isUASTC = config.mode === "auto" ? !isColor : config.mode === "uastc";
                const options: KTX2EncodeOptions = {
                    ...(isColor ? {} : { isNormalMap: usage.normal }),
                    isPerceptual: isColor,
                    isSetKTX2SRGBTransferFunc: isColor,
                    isUASTC,
                    useZstdSupercompression: isUASTC && config.zstd,
                    ...(isUASTC ? { uastcQuality: config.uastcQuality } : { etc1sQuality: config.etc1sQuality }),
                };
                const decoded = await rasterImageCodec.decodeAsync(image, mimeType);
                texture.setImage(await ktx2Encoder.encodeAsync(decoded, options));
                texture.setMimeType("image/ktx2");
                updateTextureUri(texture, "ktx2");
                encodedTexture = true;
            })
    );

    if (encodedTexture) {
        document.createExtension(KHRTextureBasisu).setRequired(true);
    }
    if (
        !document
            .getRoot()
            .listTextures()
            .some((texture) => texture.getMimeType() === "image/webp")
    ) {
        document.disposeExtension(EXTTextureWebP.EXTENSION_NAME);
    }
    return document;
}
