import { type ConnectionPoint, type File } from "./connectionPoint";
import type { AssetGraphBuildState } from "./assetGraphBuildState";
import { getNodeAssetBlockBuildState, NodeAssetBlock } from "./nodeAssetBlock";

export class OutputBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input">;

    private _data: File | undefined;
    private _dataBuildState: AssetGraphBuildState | undefined;

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

    protected override async _buildAsync(): Promise<void> {
        this._data = await this.readInputAsync(this.input);
        this._dataBuildState = getNodeAssetBlockBuildState(this);
    }

    /** @internal */
    public _invalidateData(): void {
        this._data = undefined;
        this._dataBuildState = undefined;
    }

    /** @internal */
    public _clearData(state: AssetGraphBuildState): void {
        if (this._dataBuildState !== state) {
            return;
        }

        this._data = undefined;
        this._dataBuildState = undefined;
    }
}
