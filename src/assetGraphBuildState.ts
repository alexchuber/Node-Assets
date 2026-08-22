import type { ConnectionPoint, ConnectionPointType, ConnectionPointValue } from "./connectionPoint";
import type { NodeAssetBlock } from "./nodeAssetBlock";

export class AssetGraphBuildState {
    private readonly _outputValues = new Map<ConnectionPoint<ConnectionPointType, "output">, ConnectionPointValue<ConnectionPointType>>();
    private readonly _blockBuilds = new Map<NodeAssetBlock, Promise<void>>();

    public async buildBlockAsync(block: NodeAssetBlock): Promise<void> {
        block._assertBuildAvailable(this);
        const existingBuild = this._blockBuilds.get(block);
        if (existingBuild !== undefined) {
            await existingBuild;
            return;
        }

        const build = block._buildWithStateAsync(this);
        this._blockBuilds.set(block, build);
        await build;
    }

    public async resolveInputAsync<TType extends ConnectionPointType>(input: ConnectionPoint<TType, "input">): Promise<ConnectionPointValue<TType>> {
        const output = input._getConnectedOutput();
        if (output !== undefined) {
            await this.buildBlockAsync(output._block);
        }

        const value = output === undefined ? undefined : this._outputValues.get(output);
        if (value === undefined) {
            throw new Error(`Input connection point "${input._block.name}.${input.name}" did not produce a value during this build.`);
        }

        return value as ConnectionPointValue<TType>;
    }

    public setOutputValue<TType extends ConnectionPointType>(output: ConnectionPoint<TType, "output">, value: ConnectionPointValue<TType>): void {
        this._outputValues.set(output, value);
    }
}
