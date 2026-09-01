import { OutputBlock, type BlockOptions } from "../block";
import { defineSwitchOutputBlock } from "../blockDefinition";
import { SerializeBabylonToGltfBlock } from "../serializers/babylonSceneToGltfBlock";
import { BabylonSceneType, GltfArtifactType } from "../gltf/gltfValues";

const GlbOutputBlockDefinition = defineSwitchOutputBlock({
    type: "gltf.output-glb",
    input: BabylonSceneType,
    output: GltfArtifactType,
    resolveBlock: () => new SerializeBabylonToGltfBlock({ container: "glb" }),
});

export class GlbOutputBlock extends OutputBlock<typeof GlbOutputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GlbOutputBlockDefinition>) {
        super(GlbOutputBlockDefinition, options);
    }
}
