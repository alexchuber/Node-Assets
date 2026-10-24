import { weld } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { Block, type BlockOptions } from "./block";
import { defineBlock } from "./blockDefinition";

const WeldBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.weld",
    input: GltfDocumentType,
    output: GltfDocumentType,
    runAsync: async (document) => {
        await document.transform(weld());
        return document;
    },
});

/** Options for welding identical vertices. */
export type WeldBlockOptions = BlockOptions<typeof WeldBlockDefinition>;

/** Merges bitwise-identical vertices with library-default behavior. */
export class WeldBlock extends Block<typeof WeldBlockDefinition> {
    public constructor(options?: WeldBlockOptions) {
        super(WeldBlockDefinition, options);
    }
}
