import { dequantize } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { Block, type BlockOptions } from "./block";
import { defineBlock } from "./blockDefinition";

const DequantizeBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.dequantize",
    input: GltfDocumentType,
    output: GltfDocumentType,
    runAsync: async (document) => {
        await document.transform(dequantize());
        return document;
    },
});

/** Options for restoring unquantized geometry. */
export type DequantizeBlockOptions = BlockOptions<typeof DequantizeBlockDefinition>;

/** Restores float vertex attributes and removes the mesh quantization extension. */
export class DequantizeBlock extends Block<typeof DequantizeBlockDefinition> {
    public constructor(options?: DequantizeBlockOptions) {
        super(DequantizeBlockDefinition, options);
    }
}
