import type { NodeAssetBlock } from "./nodeAssetBlock";

export type ConnectionPointType = "File" | "SceneAsset";
export type ConnectionPointDirection = "input" | "output";
export type File = Uint8Array;
export type SceneAsset = {
    readonly _sceneAssetBrand: "SceneAsset";
};

export type ConnectionPointValue<TType extends ConnectionPointType> = TType extends "File" ? File : SceneAsset;

export class ConnectionPoint<TType extends ConnectionPointType, TDirection extends ConnectionPointDirection = ConnectionPointDirection> {
    public readonly name: string;
    public readonly type: TType;
    public readonly direction: TDirection;

    /** @internal */
    public readonly _block: NodeAssetBlock;

    private _connectedOutput: ConnectionPoint<TType, "output"> | undefined;
    private readonly _endpoints: ConnectionPoint<TType, "input">[] = [];

    public constructor(name: string, type: TType, direction: TDirection, block: NodeAssetBlock) {
        this.name = name;
        this.type = type;
        this.direction = direction;
        this._block = block;
    }

    public connectTo(this: ConnectionPoint<TType, "output">, input: ConnectionPoint<TType, "input">): void;
    public connectTo(input: ConnectionPoint<TType, "input">): void {
        if (this.direction !== "output" || input.direction !== "input" || this.type !== input.type) {
            throw new Error(this._getConnectionErrorMessage(input));
        }

        if (input._connectedOutput !== undefined) {
            throw new Error(this._getConnectionErrorMessage(input));
        }

        if (this._wouldCreateCycle(input)) {
            throw new Error(this._getConnectionErrorMessage(input));
        }

        this._endpoints.push(input);
        input._connectedOutput = this as ConnectionPoint<TType, "output">;
    }

    /** @internal */
    public _getConnectedOutput(): ConnectionPoint<TType, "output"> | undefined {
        return this._connectedOutput;
    }

    /** @internal */
    public _getEndpoints(): readonly ConnectionPoint<TType, "input">[] {
        return this._endpoints;
    }

    private _wouldCreateCycle(input: ConnectionPoint<TType, "input">): boolean {
        const blocksToVisit = [input._block];
        const visitedBlocks = new Set<NodeAssetBlock>();

        while (blocksToVisit.length > 0) {
            const block = blocksToVisit.pop();
            if (block === undefined || visitedBlocks.has(block)) {
                continue;
            }

            if (block === this._block) {
                return true;
            }

            visitedBlocks.add(block);
            blocksToVisit.push(...block._getDownstreamBlocks());
        }

        return false;
    }

    private _getConnectionErrorMessage(input: ConnectionPoint<TType, "input">): string {
        return `Cannot connect these two connectors. source: "${this._block.name}".${this.name}, target: "${input._block.name}".${input.name}`;
    }
}
