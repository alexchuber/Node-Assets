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

        if (this._outputBlocks.length === 0) {
            throw new Error(`NodeAsset "${this.name}" cannot build because it has no output blocks.`);
        }

        for (const outputBlock of this._outputBlocks) {
            outputBlock._clearData();
            outputBlock._clearBuildValues();
        }

        const state = new AssetGraphBuildState();
        try {
            for (const outputBlock of this._outputBlocks) {
                await state.buildBlockAsync(outputBlock);
            }
        } catch (error) {
            for (const outputBlock of this._outputBlocks) {
                outputBlock._clearData();
                outputBlock._clearBuildValues();
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
            outputBlock._clearBuildValues();
        }
    }

    private _throwIfDisposed(): void {
        if (this._disposed) {
            throw new Error(`NodeAsset "${this.name}" has been disposed and cannot be used.`);
        }
    }
}
