import { EXTMeshGPUInstancing } from "@gltf-transform/extensions";
import { instance } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { PlatformIOResource } from "../resources/platformIOResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock, integerValue } from "./blockDefinition";

const InstanceBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.instance",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: { min: integerValue(5, { min: 1 }) },
    resources: { io: PlatformIOResource },
    runAsync: async (document, config, { io }) => {
        io.registerExtensions([EXTMeshGPUInstancing]);
        await document.transform(instance(config));
        return document;
    },
});

/** Options for creating GPU instances of shared meshes. */
export type InstanceBlockOptions = BlockOptions<typeof InstanceBlockDefinition>;

/** Creates GPU instances for shared meshes meeting the minimum count. */
export class InstanceBlock extends Block<typeof InstanceBlockDefinition> {
    public constructor(options?: InstanceBlockOptions) {
        super(InstanceBlockDefinition, options);
    }
}
