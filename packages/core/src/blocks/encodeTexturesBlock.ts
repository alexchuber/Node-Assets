import type { Extension } from "@gltf-transform/core";
import { EXTTextureAVIF, EXTTextureWebP } from "@gltf-transform/extensions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { classifyTexture, matchesTextureSlots } from "../helpers/textureUsage";
import { updateTextureUri } from "../helpers/updateTextureUri";
import { PlatformIOResource } from "../resources/platformIOResource";
import { isRasterImageMimeType, type RasterImageMimeType } from "../resources/rasterImageCodec";
import { RasterImageCodecResource } from "../resources/rasterImageCodecResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock, enumValue, integerValue } from "./blockDefinition";

const EncodeTexturesBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.encode-textures",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: {
        format: enumValue(["webp", "avif", "jpeg", "png"]),
        quality: integerValue(80, { min: 1, max: 100 }),
        slots: enumValue(["all", "color", "data"]),
    },
    resources: { codec: RasterImageCodecResource, io: PlatformIOResource },
    runAsync: async (document, config, { codec, io }) => {
        io.registerExtensions([EXTTextureWebP, EXTTextureAVIF]);
        for (const texture of document.getRoot().listTextures()) {
            const image = texture.getImage();
            const sourceMime = texture.getMimeType();
            if (image === null || !isRasterImageMimeType(sourceMime)) {
                continue;
            }
            const { category } = classifyTexture(texture);
            if (!matchesTextureSlots(category, config.slots)) {
                continue;
            }
            const decoded = await codec.decodeAsync(image, sourceMime);
            let mime: RasterImageMimeType = `image/${config.format}`;
            if (mime === "image/jpeg") {
                for (let i = 3; i < decoded.data.length; i += 4) {
                    if (decoded.data[i] !== 255) {
                        mime = "image/png";
                        break;
                    }
                }
            }
            const encoded = await codec.encodeAsync(decoded, mime, { quality: config.quality });
            const compatibilityConversion = (sourceMime === "image/webp" || sourceMime === "image/avif") && (mime === "image/jpeg" || mime === "image/png");
            if (encoded.byteLength >= image.byteLength && !compatibilityConversion) {
                continue;
            }
            texture.setImage(encoded).setMimeType(mime);
            updateTextureUri(texture, mime.slice("image/".length));
        }
        const mimes = new Set(
            document
                .getRoot()
                .listTextures()
                .map((texture) => texture.getMimeType())
        );
        for (const Extension of [EXTTextureWebP, EXTTextureAVIF] as const) {
            const mime = Extension === EXTTextureWebP ? "image/webp" : "image/avif";
            if (mimes.has(mime)) {
                document.createExtension<Extension>(Extension).setRequired(true);
            } else {
                document.disposeExtension(Extension.EXTENSION_NAME);
            }
        }
        return document;
    },
});

/** Options for encoding selected raster textures. */
export type EncodeTexturesBlockOptions = BlockOptions<typeof EncodeTexturesBlockDefinition>;

/** Encodes selected textures, preserving smaller originals except for compatibility conversion. */
export class EncodeTexturesBlock extends Block<typeof EncodeTexturesBlockDefinition> {
    public constructor(options?: EncodeTexturesBlockOptions) {
        super(EncodeTexturesBlockDefinition, options);
    }
}
