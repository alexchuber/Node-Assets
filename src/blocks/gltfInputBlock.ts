import { Block, type BlockOptions } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, UrlType } from "../block/connectionPointType";
import { NullEngineResource } from "../resources/nullEngineResource";

const GltfInputBlockDefinition = defineBlock({
    type: "input.gltf",
    input: UrlType,
    output: BabylonSceneType,
    resources: {
        engine: NullEngineResource,
    },
    runAsync: async (url, _config, { engine }) => {
        await import("@babylonjs/loaders/glTF");
        const { LoadSceneAsync } = await import("@babylonjs/core/Loading/sceneLoader");
        return LoadSceneAsync(url, engine);
    },
});

/** Loads a glTF or GLB URL into a Babylon.js scene. */
export class GltfInputBlock extends Block<typeof GltfInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GltfInputBlockDefinition>) {
        super(GltfInputBlockDefinition, options);
    }
}
