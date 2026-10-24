import { KHRMaterialsIOR, KHRMaterialsSpecular } from "@gltf-transform/extensions";
import { metalRough } from "@gltf-transform/functions";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { PlatformIOResource } from "../resources/platformIOResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock } from "./blockDefinition";

const MetalRoughBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "transform.metal-rough",
    input: GltfDocumentType,
    output: GltfDocumentType,
    resources: { io: PlatformIOResource },
    runAsync: async (document, _config, { io }) => {
        if (document.hasExtension("KHR_materials_pbrSpecularGlossiness")) {
            io.registerExtensions([KHRMaterialsIOR, KHRMaterialsSpecular]);
            await document.transform(metalRough());
        }
        return document;
    },
});

/** Options for converting specular/glossiness materials. */
export type MetalRoughBlockOptions = BlockOptions<typeof MetalRoughBlockDefinition>;

/** Converts specular/glossiness materials to metallic/roughness. */
export class MetalRoughBlock extends Block<typeof MetalRoughBlockDefinition> {
    public constructor(options?: MetalRoughBlockOptions) {
        super(MetalRoughBlockDefinition, options);
    }
}
