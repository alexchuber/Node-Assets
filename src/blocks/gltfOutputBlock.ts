import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";

import { Block, type BlockOptions, type InputPort } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, DracoEncoderType, FileType } from "../block/connectionPointType";

const GltfOutputBlockDefinition = defineBlock({
    type: "output.gltf",
    input: BabylonSceneType,
    auxiliaryInputs: {
        geometryCompressor: DracoEncoderType,
    },
    output: FileType,
    runAsync: (scene, _config, _resources, { geometryCompressor }) => serializeGlbAsync(scene, geometryCompressor === undefined ? undefined : "Draco"),
});

/** Options for naming the block or supplying its initial scene input. */
export type GltfOutputBlockOptions = BlockOptions<typeof GltfOutputBlockDefinition>;

/** Serializes a Babylon.js scene to a binary glTF file. */
export class GltfOutputBlock extends Block<typeof GltfOutputBlockDefinition> {
    public readonly geometryCompressor: InputPort<typeof DracoEncoderType>;

    public constructor(options?: GltfOutputBlockOptions) {
        super(GltfOutputBlockDefinition, options);
        this.geometryCompressor = this.auxiliaryInputs.geometryCompressor;
    }
}

async function serializeGlbAsync(scene: BabylonScene, meshCompressionMethod: "Draco" | undefined): Promise<File> {
    const { GLTF2Export } = await import("@babylonjs/serializers/glTF/2.0/glTFSerializer.js");
    const fileName = "scene.glb";
    const result =
        meshCompressionMethod === undefined
            ? await GLTF2Export.GLBAsync(scene, fileName)
            : await GLTF2Export.GLBAsync(scene, fileName, {
                  meshCompressionMethod,
              });
    const root = result.files[fileName];
    if (!(root instanceof Blob)) {
        throw new Error(`The Babylon glTF serializer did not produce "${fileName}".`);
    }
    return new File([root], fileName, { type: "model/gltf-binary", lastModified: 0 });
}
