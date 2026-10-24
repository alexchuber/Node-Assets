import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { MeshoptEncoderResource } from "../resources/meshoptEncoderResource";
import { PlatformIOResource } from "../resources/platformIOResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock, enumValue } from "./blockDefinition";

const EncodeMeshoptBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.encode-meshopt",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: {
        level: enumValue(["medium", "high"], "high"),
    },
    resources: {
        encoder: MeshoptEncoderResource,
        io: PlatformIOResource,
    },
    runAsync: async (document, config, { encoder, io }) => {
        io.registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.encoder": encoder });
        await document.transform(meshopt({ encoder, ...config }));
        return document;
    },
});

/** Options for Meshopt compression. */
export type EncodeMeshoptBlockOptions = BlockOptions<typeof EncodeMeshoptBlockDefinition>;

/** Applies Meshopt compression. */
export class EncodeMeshoptBlock extends Block<typeof EncodeMeshoptBlockDefinition> {
    public constructor(options?: EncodeMeshoptBlockOptions) {
        super(EncodeMeshoptBlockDefinition, options);
    }
}
