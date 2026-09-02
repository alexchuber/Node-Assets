import type { Scene as BabylonScene } from "@babylonjs/core/scene";

import { Block, type BlockOptions } from "../block";
import { defineBlock } from "../blockDefinition";
import { BabylonSceneType, FileType } from "../../connectionPointType";

const GltfOutputBlockDefinition = defineBlock({
    type: "output.gltf",
    input: BabylonSceneType,
    output: FileType,
    runAsync: serializeGlbAsync,
});

export type GltfOutputBlockOptions = BlockOptions<typeof GltfOutputBlockDefinition>;

export class GltfOutputBlock extends Block<typeof GltfOutputBlockDefinition> {
    public constructor(options?: GltfOutputBlockOptions) {
        super(GltfOutputBlockDefinition, options);
    }
}

async function serializeGlbAsync(scene: BabylonScene): Promise<File> {
    const { GLTF2Export } = await import("@babylonjs/serializers/glTF/2.0/glTFSerializer");
    const fileName = "scene.glb";
    const result = await GLTF2Export.GLBAsync(scene, fileName);
    const root = result.files[fileName];
    if (!(root instanceof Blob)) {
        throw new Error(`The Babylon glTF serializer did not produce "${fileName}".`);
    }
    return new File([root], fileName, { type: "model/gltf-binary", lastModified: 0 });
}
