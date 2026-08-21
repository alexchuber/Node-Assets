import { type ConnectionPoint, type File } from "./connectionPoint";
import { NodeAssetBlock } from "./nodeAssetBlock";
import type { AssetGraphBuildState } from "./assetGraphBuildState";

export class OutputBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input">;

    private _data: File | undefined;

    public constructor(name: string) {
        super(name);
        this.input = this.registerInput("input", "File");
    }

    public get data(): File {
        if (this._data === undefined) {
            throw new Error(`Output block "${this.name}" has no data because the graph has not built successfully.`);
        }

        return this._data;
    }

    protected override async _buildAsync(state: AssetGraphBuildState): Promise<void> {
        this._data = await state.resolveInputAsync(this.input);
    }

    /** @internal */
    public _clearData(): void {
        this._data = undefined;
    }
}
