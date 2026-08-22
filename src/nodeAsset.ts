import { AssetGraphBuildState } from "./assetGraphBuildState";
import type { OutputBlock } from "./outputBlock";

export class NodeAsset {
    public readonly name: string;

    private readonly _outputBlocks: OutputBlock[] = [];
    private _disposed = false;
    private _buildInProgress = false;
    private _buildVersion = 0;
    private _buildState: AssetGraphBuildState | undefined;
    private _successfulBuildState: AssetGraphBuildState | undefined;

    public constructor(name: string) {
        this.name = name;
    }

    public addOutputBlock(outputBlock: OutputBlock): void {
        this._throwIfDisposed();
        this._outputBlocks.push(outputBlock);
    }

    public async buildAsync(): Promise<void> {
        this._throwIfDisposed();
        if (this._buildInProgress) {
            throw new Error(`NodeAsset "${this.name}" cannot build because a build is already in progress.`);
        }

        this._buildInProgress = true;
        const buildVersion = ++this._buildVersion;
        const outputBlocks = this._outputBlocks;
        let ownsOutputBuild = false;
        let buildState: AssetGraphBuildState | undefined;
        try {
            if (outputBlocks.length === 0) {
                return;
            }

            const state = new AssetGraphBuildState();
            buildState = state;
            this._buildState = state;
            for (const outputBlock of outputBlocks) {
                outputBlock._assertBuildAvailable(state);
            }

            ownsOutputBuild = true;
            this._successfulBuildState = undefined;
            for (const outputBlock of outputBlocks) {
                outputBlock._invalidateData();
            }
            this._validateOutputBlockNames(outputBlocks);
            for (const outputBlock of outputBlocks) {
                await state.buildBlockAsync(outputBlock);
            }
            this._throwIfBuildWasDisposed(buildVersion);
            this._successfulBuildState = state;
        } catch (error) {
            if (ownsOutputBuild && buildState !== undefined) {
                for (const outputBlock of outputBlocks) {
                    outputBlock._clearData(buildState);
                }
            }
            throw error;
        } finally {
            if (buildState !== undefined && this._buildState === buildState) {
                this._buildState = undefined;
            }
            this._buildInProgress = false;
        }
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._buildVersion += 1;
        const ownershipState = this._buildState ?? this._successfulBuildState;
        this._successfulBuildState = undefined;
        if (ownershipState !== undefined) {
            for (const outputBlock of this._outputBlocks) {
                outputBlock._clearData(ownershipState);
            }
        }
    }

    private _throwIfDisposed(): void {
        if (this._disposed) {
            throw new Error(`NodeAsset "${this.name}" has been disposed and cannot be used.`);
        }
    }

    private _throwIfBuildWasDisposed(buildVersion: number): void {
        if (this._disposed || buildVersion !== this._buildVersion) {
            throw new Error(`NodeAsset "${this.name}" was disposed while a build was in progress.`);
        }
    }

    private _validateOutputBlockNames(outputBlocks: readonly OutputBlock[]): void {
        const nameCounts = new Map<string, number>();
        for (const outputBlock of outputBlocks) {
            nameCounts.set(outputBlock.name, (nameCounts.get(outputBlock.name) ?? 0) + 1);
        }

        const duplicateNames = [...nameCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([name]) => name)
            .sort();
        if (duplicateNames.length > 0) {
            const names = duplicateNames.map((name) => `"${name}"`).join(", ");
            throw new Error(`NodeAsset "${this.name}" has duplicate output block names: ${names}.`);
        }
    }
}
