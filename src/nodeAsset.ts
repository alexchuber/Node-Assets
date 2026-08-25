import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { AssetGraphBuildState } from "./assetGraphBuildState";
import { getAssetGraphValidationError } from "./assetGraphValidation";
import type { OutputBlock } from "./blocks/outputBlock";

interface OwnedBuild {
    readonly outputBlocks: readonly OutputBlock[];
    readonly state: AssetGraphBuildState;
}

export class NodeAsset {
    public readonly name: string;

    private readonly _outputBlocks: OutputBlock[] = [];
    private _disposed = false;
    private _activeBuild: OwnedBuild | undefined;
    private _successfulBuild: OwnedBuild | undefined;

    public constructor(name: string) {
        this.name = name;
    }

    public addOutputBlock(outputBlock: OutputBlock): void {
        this._throwIfDisposed();
        this._outputBlocks.push(outputBlock);
    }

    public async buildAsync(): Promise<void> {
        this._throwIfDisposed();
        if (this._activeBuild !== undefined) {
            throw new Error(`NodeAsset "${this.name}" cannot build because a build is already in progress.`);
        }

        const outputBlocks: readonly OutputBlock[] = [...this._outputBlocks];
        let ownsOutputBuild = false;
        let engine: NullEngine | undefined;
        let build: OwnedBuild | undefined;
        try {
            engine = new NullEngine();
            const state = new AssetGraphBuildState(engine, this.name);
            build = { outputBlocks, state };
            this._activeBuild = build;
            if (outputBlocks.length === 0) {
                throw new Error(`NodeAsset "${this.name}" cannot build because no output block has been registered.`);
            }

            for (const outputBlock of outputBlocks) {
                outputBlock._assertBuildAvailable(state);
            }

            const graphValidationError = getAssetGraphValidationError(outputBlocks, this.name);
            ownsOutputBuild = true;
            const previousSuccessfulBuild = this._successfulBuild;
            this._successfulBuild = undefined;
            for (const outputBlock of outputBlocks) {
                outputBlock._invalidateData(previousSuccessfulBuild?.state);
            }
            if (graphValidationError !== undefined) {
                throw graphValidationError;
            }
            for (const outputBlock of outputBlocks) {
                await state.buildBlockAsync(outputBlock);
            }
            state._throwIfDisposed();
            this._successfulBuild = build;
        } catch (error) {
            if (ownsOutputBuild && build !== undefined) {
                for (const outputBlock of build.outputBlocks) {
                    outputBlock._clearData(build.state);
                }
            }
            if (build?.state._isDisposed()) {
                throw build.state._getDisposalError();
            }
            throw error;
        } finally {
            try {
                if (build !== undefined) {
                    build.state._dispose();
                } else {
                    engine?.dispose();
                }
            } finally {
                if (this._activeBuild === build) {
                    this._activeBuild = undefined;
                }
            }
        }
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        const ownedBuild = this._activeBuild ?? this._successfulBuild;
        this._successfulBuild = undefined;
        try {
            if (ownedBuild !== undefined) {
                for (const outputBlock of ownedBuild.outputBlocks) {
                    outputBlock._clearData(ownedBuild.state);
                }
            }
        } finally {
            ownedBuild?.state._dispose();
        }
    }

    private _throwIfDisposed(): void {
        if (this._disposed) {
            throw new Error(`NodeAsset "${this.name}" has been disposed and cannot be used.`);
        }
    }
}
