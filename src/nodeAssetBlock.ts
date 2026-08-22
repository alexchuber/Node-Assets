import { ConnectionPoint, type ConnectionPointType, type ConnectionPointValue } from "./connectionPoint";
import type { AssetGraphBuildState } from "./assetGraphBuildState";

export abstract class NodeAssetBlock {
    public readonly name: string;

    private readonly _inputs: ConnectionPoint<ConnectionPointType, "input">[] = [];
    private readonly _outputs: ConnectionPoint<ConnectionPointType, "output">[] = [];
    private _buildState: AssetGraphBuildState | undefined;

    public constructor(name: string) {
        this.name = name;
    }

    protected registerInput<TType extends ConnectionPointType>(name: string, type: TType): ConnectionPoint<TType, "input"> {
        const input = new ConnectionPoint(name, type, "input", this);
        this._inputs.push(input);
        return input;
    }

    protected registerOutput<TType extends ConnectionPointType>(name: string, type: TType): ConnectionPoint<TType, "output"> {
        const output = new ConnectionPoint(name, type, "output", this);
        this._outputs.push(output);
        return output;
    }

    /** @internal */
    public _getInputs(): readonly ConnectionPoint<ConnectionPointType, "input">[] {
        return this._inputs;
    }

    /** @internal */
    public _assertBuildAvailable(state: AssetGraphBuildState): void {
        if (this._buildState !== undefined && this._buildState !== state) {
            throw new Error(`Block "${this.name}" cannot be built concurrently because it is already executing.`);
        }
    }

    /** @internal */
    public _getDownstreamBlocks(): readonly NodeAssetBlock[] {
        return this._outputs.flatMap((output) => output._getEndpoints().map((input) => input._block));
    }

    /** @internal */
    public async _buildWithStateAsync(state: AssetGraphBuildState): Promise<void> {
        this._assertBuildAvailable(state);

        const ownsBuildState = this._buildState === undefined;
        if (ownsBuildState) {
            this._buildState = state;
        }

        try {
            await this._buildAsync();
        } finally {
            if (ownsBuildState && this._buildState === state) {
                this._buildState = undefined;
            }
        }
    }

    protected readInputAsync<TType extends ConnectionPointType>(input: ConnectionPoint<TType, "input">): Promise<ConnectionPointValue<TType>> {
        return this._getBuildState().resolveInputAsync(input);
    }

    protected writeOutput<TType extends ConnectionPointType>(output: ConnectionPoint<TType, "output">, value: ConnectionPointValue<TType>): void {
        this._getBuildState().setOutputValue(output, value);
    }

    protected _getBuildState(): AssetGraphBuildState {
        if (this._buildState === undefined) {
            throw new Error(`Block "${this.name}" can only read or write values during a graph build.`);
        }

        return this._buildState;
    }

    protected abstract _buildAsync(): Promise<void>;
}
