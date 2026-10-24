import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { classifyTexture, matchesTextureSlots } from "../helpers/textureUsage";
import { RasterImageCodecResource } from "../resources/rasterImageCodecResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock, enumValue, integerValue } from "./blockDefinition";

const ResizeTexturesBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.resize-textures",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: {
        maxSize: integerValue(2048, { min: 1, max: 16384 }),
        slots: enumValue(["all", "color", "data"]),
    },
    resources: { codec: RasterImageCodecResource },
    runAsync: async (document, config, { codec }) => {
        for (const texture of document.getRoot().listTextures()) {
            const image = texture.getImage();
            const mime = texture.getMimeType();
            if (image === null || (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp")) {
                continue;
            }
            const { category } = classifyTexture(texture);
            if (!matchesTextureSlots(category, config.slots)) {
                continue;
            }
            const resized = await codec.resizeAsync(image, mime, config.maxSize);
            if (resized !== null) {
                texture.setImage(resized);
            }
        }
        return document;
    },
});

/** Options for resizing raster textures without upscaling. */
export type ResizeTexturesBlockOptions = BlockOptions<typeof ResizeTexturesBlockDefinition>;

/** Fits selected JPEG, PNG, and WebP textures within a maximum size. */
export class ResizeTexturesBlock extends Block<typeof ResizeTexturesBlockDefinition> {
    public constructor(options?: ResizeTexturesBlockOptions) {
        super(ResizeTexturesBlockDefinition, options);
    }
}
