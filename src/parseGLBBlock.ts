import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Scene } from "@babylonjs/core/scene.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { type ConnectionPoint } from "./connectionPoint";
import { getNodeAssetBlockBuildState, NodeAssetBlock } from "./nodeAssetBlock";
import { SceneAsset } from "./sceneAsset";

let gltfLoaderRegistered = false;

export class ParseGLBBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input">;
    public readonly output: ConnectionPoint<"SceneAsset", "output">;

    public constructor(name: string) {
        super(name);
        this.input = this.registerInput("input", "File");
        this.output = this.registerOutput("output", "SceneAsset");
    }

    protected override async _buildAsync(): Promise<void> {
        const bytes = await this.readInputAsync(this.input);
        const state = getNodeAssetBlockBuildState(this);
        if (!gltfLoaderRegistered) {
            registerBuiltInLoaders();
            gltfLoaderRegistered = true;
        }

        const scene = new Scene(state._engine);
        state._trackScene(scene);

        try {
            const assetContainer = await LoadAssetContainerAsync(bytes, scene, {
                name: `${this.name}.glb`,
                pluginExtension: ".glb",
            });
            assetContainer.addAllToScene();
            this.writeOutput(this.output, new SceneAsset(scene, assetContainer));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Parse GLB block "${this.name}" failed: ${message}`, { cause: error });
        }
    }
}
