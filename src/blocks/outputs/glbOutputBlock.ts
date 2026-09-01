import { OutputBlock, type BlockOptions } from "../block";
import { defineRoutedOutputBlock, oneOfValueTypes } from "../blockDefinition";
import { GltfToBabylonSceneBlock } from "../parsers/gltfToBabylonScene";
import { SerializeBabylonToGltfBlock } from "../serializers/babylonSceneToGltfBlock";
import { BabylonSceneType, GltfArtifactType } from "../../gltfValues";

const GlbOutputInputType = oneOfValueTypes(GltfArtifactType, BabylonSceneType);

const GlbOutputBlockDefinition = defineRoutedOutputBlock({
    type: "gltf.output-glb",
    input: GlbOutputInputType,
    output: GltfArtifactType,
    resolveRoute: (sourceType) => {
        const serializer = new SerializeBabylonToGltfBlock({ container: "glb" });
        if (GltfArtifactType.accepts(sourceType)) {
            return [new GltfToBabylonSceneBlock(), serializer];
        }
        if (BabylonSceneType.accepts(sourceType)) {
            return [serializer];
        }
        throw new Error(`GlbOutputBlock does not support "${sourceType.id}".`);
    },
});

export class GlbOutputBlock extends OutputBlock<typeof GlbOutputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GlbOutputBlockDefinition>) {
        super(GlbOutputBlockDefinition, options);
    }
}
