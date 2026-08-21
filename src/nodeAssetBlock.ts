import { ConnectionPoint, type ConnectionPointType } from "./connectionPoint";
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
    public async _buildWithStateAsync(state: AssetGraphBuildState): Promise<void> {
        await this._buildAsync(state);
    }

    /** @internal */
    public _clearBuildValues(): void {
        for (const input of this._inputs) {
            input._clearValue();
        }

        for (const output of this._outputs) {
            output._clearValue();
        }
    }

    protected abstract _buildAsync(state: AssetGraphBuildState): Promise<void>;
}
