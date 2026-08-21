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
    private _value: ConnectionPointValue<TType> | undefined;

    public constructor(name: string, type: TType, direction: TDirection, block: NodeAssetBlock) {
        this.name = name;
        this.type = type;
        this.direction = direction;
        this._block = block;
    }

    public connectTo(input: ConnectionPoint<TType, "input">): void {
        if (this.direction !== "output") {
            throw new Error(`Connection point "${this._block.name}.${this.name}" is an input and cannot connect to another input.`);
        }

        if (input.direction !== "input") {
            throw new Error(`Connection point "${input._block.name}.${input.name}" is an output and cannot receive a connection.`);
        }

        if (this.type !== input.type) {
            throw new Error(`Cannot connect "${this._block.name}.${this.name}" of type "${this.type}" to "${input._block.name}.${input.name}" of type "${input.type}".`);
        }

        if (input._connectedOutput !== undefined) {
            throw new Error(`Input connection point "${input._block.name}.${input.name}" is already connected.`);
        }

        input._connectedOutput = this as ConnectionPoint<TType, "output">;
    }

    /** @internal */
    public _getConnectedOutput(): ConnectionPoint<TType, "output"> | undefined {
        return this._connectedOutput;
    }

    /** @internal */
    public _getValue(): ConnectionPointValue<TType> | undefined {
        return this._value;
    }

    /** @internal */
    public _setValue(value: ConnectionPointValue<TType>): void {
        this._value = value;
    }

    /** @internal */
    public _clearValue(): void {
        this._value = undefined;
    }
}
