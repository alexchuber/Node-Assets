import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { draco } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { DracoEncoderResource } from "../resources/dracoEncoderResource";
import { PlatformIOResource } from "../resources/platformIOResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock, enumValue, integerValue } from "./blockDefinition";

const EncodeDracoBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.encode-draco",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: {
        method: enumValue(["edgebreaker", "sequential"]),
        encodeSpeed: integerValue(5, { min: 0, max: 10 }),
        decodeSpeed: integerValue(5, { min: 0, max: 10 }),
        quantizePosition: integerValue(14, { min: 1, max: 30 }),
        quantizeNormal: integerValue(10, { min: 1, max: 30 }),
        quantizeColor: integerValue(8, { min: 1, max: 30 }),
        quantizeTexcoord: integerValue(12, { min: 1, max: 30 }),
        quantizeGeneric: integerValue(12, { min: 1, max: 30 }),
    },
    resources: {
        encoder: DracoEncoderResource,
        io: PlatformIOResource,
    },
    runAsync: async (document, config, { encoder, io }) => {
        io.registerExtensions([KHRDracoMeshCompression]).registerDependencies({ "draco3d.encoder": encoder });
        await document.transform(draco(config));
        return document;
    },
});

/** Options for Draco compression speed and quantization. */
export type EncodeDracoBlockOptions = BlockOptions<typeof EncodeDracoBlockDefinition>;

/** Applies Draco compression with configurable speed and quantization. */
export class EncodeDracoBlock extends Block<typeof EncodeDracoBlockDefinition> {
    public constructor(options?: EncodeDracoBlockOptions) {
        super(EncodeDracoBlockDefinition, options);
    }
}
