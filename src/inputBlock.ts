import { type ConnectionPoint, type File } from "./connectionPoint";
import { NodeAssetBlock } from "./nodeAssetBlock";
import type { AssetGraphBuildState } from "./assetGraphBuildState";

export class InputBlock extends NodeAssetBlock {
    public readonly output: ConnectionPoint<"File", "output">;
    public source: File | undefined;

    public constructor(name: string) {
        super(name);
        this.output = this.registerOutput("output", "File");
    }

    protected override _buildAsync(state: AssetGraphBuildState): Promise<void> {
        if (!(this.source instanceof Uint8Array)) {
            throw new Error(`Input block "${this.name}" requires an in-memory Uint8Array source.`);
        }

        state.setOutputValue(this.output, this.source);
        return Promise.resolve();
    }
}
