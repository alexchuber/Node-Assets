import { ConnectionPoint, type ConnectionPointType, type ConnectionPointValue } from "./connectionPoint";
import type { AssetGraphBuildState } from "./assetGraphBuildState";

export abstract class NodeAssetBlock {
    public readonly name: string;

    private readonly _inputs: ConnectionPoint<ConnectionPointType, "input">[] = [];
    private readonly _outputs: ConnectionPoint<ConnectionPointType, "output">[] = [];

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
        const currentState = blockBuildStates.get(this);
        if (currentState !== undefined && currentState !== state) {
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

        const ownsBuildState = blockBuildStates.get(this) === undefined;
        if (ownsBuildState) {
            blockBuildStates.set(this, state);
        }

        try {
            await this._buildAsync();
        } finally {
            if (ownsBuildState && blockBuildStates.get(this) === state) {
                blockBuildStates.delete(this);
            }
        }
    }

    protected readInputAsync<TType extends ConnectionPointType>(input: ConnectionPoint<TType, "input">): Promise<ConnectionPointValue<TType>> {
        return getNodeAssetBlockBuildState(this).resolveInputAsync(input);
    }

    protected writeOutput<TType extends ConnectionPointType>(output: ConnectionPoint<TType, "output">, value: ConnectionPointValue<TType>): void {
        getNodeAssetBlockBuildState(this).setOutputValue(output, value);
    }

    protected abstract _buildAsync(): Promise<void>;
}

const blockBuildStates = new WeakMap<NodeAssetBlock, AssetGraphBuildState>();

/** @internal */
export function getNodeAssetBlockBuildState(block: NodeAssetBlock): AssetGraphBuildState {
    const state = blockBuildStates.get(block);
    if (state === undefined) {
        throw new Error(`Block "${block.name}" can only read or write values during a graph build.`);
    }

    return state;
}
