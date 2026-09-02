import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";

import { Block, type BlockOptions } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, FileType } from "../block/connectionPointType";

const GltfOutputBlockDefinition = defineBlock({
    type: "output.gltf",
    input: BabylonSceneType,
    output: FileType,
    runAsync: serializeGlbAsync,
});

/** Options for naming the block or supplying its initial scene input. */
export type GltfOutputBlockOptions = BlockOptions<typeof GltfOutputBlockDefinition>;

/** Serializes a Babylon.js scene to a binary glTF file. */
export class GltfOutputBlock extends Block<typeof GltfOutputBlockDefinition> {
    public constructor(options?: GltfOutputBlockOptions) {
        super(GltfOutputBlockDefinition, options);
    }
}

async function serializeGlbAsync(scene: BabylonScene): Promise<File> {
    const { GLTF2Export } = await import("@babylonjs/serializers/glTF/2.0/glTFSerializer.js");
    const fileName = "scene.glb";
    const result = await GLTF2Export.GLBAsync(scene, fileName);
    const root = result.files[fileName];
    if (!(root instanceof Blob)) {
        throw new Error(`The Babylon glTF serializer did not produce "${fileName}".`);
    }
    return new File([root], fileName, { type: "model/gltf-binary", lastModified: 0 });
}
