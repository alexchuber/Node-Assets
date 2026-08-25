import { type ConnectionPoint } from "../connectionPoint";
import { loadGlbSceneAssetAsync } from "../loadGlbSceneAsset";
import { createNodeAssetBlockError, getNodeAssetBlockBuildState, getNodeAssetBlockErrorReason, NodeAssetBlock } from "./nodeAssetBlock";

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

        try {
            const sceneAsset = await loadGlbSceneAssetAsync(state, bytes, `${this.name}.glb`);
            this.writeOutput(this.output, sceneAsset);
        } catch (error) {
            state._throwIfDisposed();
            throw createNodeAssetBlockError(this, `Parse GLB block "${this.name}" failed: ${getNodeAssetBlockErrorReason(error)}`, error);
        }
    }
}
