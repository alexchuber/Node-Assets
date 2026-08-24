import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { AssetGraphBuildState } from "./assetGraphBuildState";
import type { OutputBlock } from "./outputBlock";

export class NodeAsset {
    public readonly name: string;

    private readonly _outputBlocks: OutputBlock[] = [];
    private _disposed = false;
    private _buildInProgress = false;
    private _buildVersion = 0;
    private _buildState: AssetGraphBuildState | undefined;
    private _activeOutputBlocks: readonly OutputBlock[] | undefined;
    private _successfulBuildState: AssetGraphBuildState | undefined;
    private _successfulOutputBlocks: readonly OutputBlock[] | undefined;

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

        const outputBlocks: readonly OutputBlock[] = [...this._outputBlocks];
        this._buildInProgress = true;
        const buildVersion = ++this._buildVersion;
        this._activeOutputBlocks = outputBlocks;
        let ownsOutputBuild = false;
        let engine: NullEngine | undefined;
        let state: AssetGraphBuildState | undefined;
        try {
            engine = new NullEngine();
            state = new AssetGraphBuildState(engine);
            this._buildState = state;
            if (outputBlocks.length === 0) {
                throw new Error(`NodeAsset "${this.name}" cannot build because no output block has been registered.`);
            }

            for (const outputBlock of outputBlocks) {
                outputBlock._assertBuildAvailable(state);
            }

            const graphValidation = state._validateGraph(outputBlocks);
            ownsOutputBuild = true;
            const previousSuccessfulBuildState = this._successfulBuildState;
            this._successfulBuildState = undefined;
            this._successfulOutputBlocks = undefined;
            for (const outputBlock of outputBlocks) {
                outputBlock._invalidateData(previousSuccessfulBuildState);
            }
            state._assertGraphValidationValid(graphValidation, this.name);
            for (const outputBlock of outputBlocks) {
                await state.buildBlockAsync(outputBlock);
            }
            this._throwIfBuildWasDisposed(buildVersion);
            this._successfulBuildState = state;
            this._successfulOutputBlocks = outputBlocks;
        } catch (error) {
            if (ownsOutputBuild && state !== undefined) {
                for (const outputBlock of outputBlocks) {
                    outputBlock._clearData(state);
                }
            }
            throw error;
        } finally {
            try {
                state?._dispose();
            } finally {
                try {
                    engine?.dispose();
                } finally {
                    if (state !== undefined && this._buildState === state) {
                        this._buildState = undefined;
                    }
                    if (this._activeOutputBlocks === outputBlocks) {
                        this._activeOutputBlocks = undefined;
                    }
                    this._buildInProgress = false;
                }
            }
        }
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._buildVersion += 1;
        const ownershipState = this._buildState ?? this._successfulBuildState;
        const ownedOutputBlocks = this._buildState !== undefined ? this._activeOutputBlocks : this._successfulOutputBlocks;
        this._successfulBuildState = undefined;
        this._successfulOutputBlocks = undefined;
        if (ownershipState !== undefined && ownedOutputBlocks !== undefined) {
            for (const outputBlock of ownedOutputBlocks) {
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
}
