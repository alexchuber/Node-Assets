import { flatten } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { Block, type BlockOptions } from "./block";
import { defineBlock } from "./blockDefinition";

const FlattenBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.flatten",
    input: GltfDocumentType,
    output: GltfDocumentType,
    runAsync: async (document) => {
        const root = document.getRoot();
        if (root.listAnimations().length === 0 && root.listSkins().length === 0) {
            await document.transform(flatten());
        }
        return document;
    },
});

/** Options for flattening a static scene hierarchy. */
export type FlattenBlockOptions = BlockOptions<typeof FlattenBlockDefinition>;

/** Flattens static scene hierarchies, leaving animated or skinned documents unchanged. */
export class FlattenBlock extends Block<typeof FlattenBlockDefinition> {
    public constructor(options?: FlattenBlockOptions) {
        super(FlattenBlockDefinition, options);
    }
}
