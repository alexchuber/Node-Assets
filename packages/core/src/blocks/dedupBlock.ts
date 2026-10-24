import { dedup } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { Block, type BlockOptions } from "./block";
import { defineBlock } from "./blockDefinition";

const DedupBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.dedup",
    input: GltfDocumentType,
    output: GltfDocumentType,
    runAsync: async (document) => {
        await document.transform(dedup());
        return document;
    },
});

/** Options for deduplicating document resources. */
export type DedupBlockOptions = BlockOptions<typeof DedupBlockDefinition>;

/** Deduplicates document resources with library-default behavior. */
export class DedupBlock extends Block<typeof DedupBlockDefinition> {
    public constructor(options?: DedupBlockOptions) {
        super(DedupBlockDefinition, options);
    }
}
