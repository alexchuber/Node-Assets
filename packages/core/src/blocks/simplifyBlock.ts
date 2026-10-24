import { simplify } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { MeshoptSimplifierResource } from "../resources/meshoptSimplifierResource";
import { Block, type BlockOptions } from "./block";
import { booleanValue, defineBlock, numberValue } from "./blockDefinition";

const SimplifyBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.simplify",
    input: GltfDocumentType,
    output: GltfDocumentType,
    config: {
        ratio: numberValue(0, { min: 0, max: 1 }),
        error: numberValue(0.0001, { min: 0 }),
        lockBorder: booleanValue(false),
    },
    resources: { simplifier: MeshoptSimplifierResource },
    runAsync: async (document, config, { simplifier }) => {
        await document.transform(simplify({ simplifier, ...config }));
        return document;
    },
});

/** Options for simplifying geometry within an error limit. */
export type SimplifyBlockOptions = BlockOptions<typeof SimplifyBlockDefinition>;

/** Simplifies triangle geometry, welding unindexed primitives internally. */
export class SimplifyBlock extends Block<typeof SimplifyBlockDefinition> {
    public constructor(options?: SimplifyBlockOptions) {
        super(SimplifyBlockDefinition, options);
    }
}
