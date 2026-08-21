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

    public constructor(name: string, type: TType, direction: TDirection, block: NodeAssetBlock) {
        this.name = name;
        this.type = type;
        this.direction = direction;
        this._block = block;
    }

    public connectTo(input: ConnectionPoint<TType, "input">): void {
        if (this.type !== input.type) {
            throw new Error(`Cannot connect "${this._block.name}.${this.name}" of type "${this.type}" to "${input._block.name}.${input.name}" of type "${input.type}".`);
        }

        input._connectedOutput = this as ConnectionPoint<TType, "output">;
    }

    /** @internal */
    public _getConnectedOutput(): ConnectionPoint<TType, "output"> | undefined {
        return this._connectedOutput;
    }
}
