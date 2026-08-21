import { AssetGraphBuildState } from "./assetGraphBuildState";
import type { OutputBlock } from "./outputBlock";

export class NodeAsset {
    public readonly name: string;

    private readonly _outputBlocks: OutputBlock[] = [];
    private _disposed = false;

    public constructor(name: string) {
        this.name = name;
    }

    public addOutputBlock(outputBlock: OutputBlock): void {
        this._throwIfDisposed();
        this._outputBlocks.push(outputBlock);
    }

    public async buildAsync(): Promise<void> {
        this._throwIfDisposed();

        for (const outputBlock of this._outputBlocks) {
            outputBlock._clearData();
        }

        const state = new AssetGraphBuildState();
        try {
            for (const outputBlock of this._outputBlocks) {
                await state.buildBlockAsync(outputBlock);
            }
        } catch (error) {
            for (const outputBlock of this._outputBlocks) {
                outputBlock._clearData();
            }
            throw error;
        }
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        for (const outputBlock of this._outputBlocks) {
            outputBlock._clearData();
        }
    }

    private _throwIfDisposed(): void {
        if (this._disposed) {
            throw new Error(`NodeAsset "${this.name}" has been disposed and cannot be used.`);
        }
    }
}
