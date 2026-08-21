import type { ConnectionPoint, ConnectionPointType, ConnectionPointValue } from "./connectionPoint";
import type { NodeAssetBlock } from "./nodeAssetBlock";

export class AssetGraphBuildState {
    private readonly _buildingBlocks = new Set<NodeAssetBlock>();
    private readonly _builtBlocks = new Set<NodeAssetBlock>();

    public async buildBlockAsync(block: NodeAssetBlock): Promise<void> {
        if (this._builtBlocks.has(block)) {
            return;
        }

        if (this._buildingBlocks.has(block)) {
            throw new Error(`Cannot build block "${block.name}" because the graph contains a cycle.`);
        }

        this._buildingBlocks.add(block);
        try {
            await block._buildWithStateAsync(this);
            this._builtBlocks.add(block);
        } finally {
            this._buildingBlocks.delete(block);
        }
    }

    public async resolveInputAsync<TType extends ConnectionPointType>(input: ConnectionPoint<TType, "input">): Promise<ConnectionPointValue<TType>> {
        const output = input._getConnectedOutput();
        if (output === undefined) {
            throw new Error(`Input connection point "${input._block.name}.${input.name}" is not connected.`);
        }

        await this.buildBlockAsync(output._block);

        const value = output._getValue();
        if (value === undefined) {
            throw new Error(`Output connection point "${output._block.name}.${output.name}" did not produce a value during the build.`);
        }

        return value;
    }

    public setOutputValue<TType extends ConnectionPointType>(output: ConnectionPoint<TType, "output">, value: ConnectionPointValue<TType>): void {
        output._setValue(value);
    }
}
