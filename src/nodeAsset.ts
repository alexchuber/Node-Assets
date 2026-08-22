import { AssetGraphBuildState } from "./assetGraphBuildState";
import type { OutputBlock } from "./outputBlock";

export class NodeAsset {
    public readonly name: string;

    private _outputBlock: OutputBlock | undefined;
    private _disposed = false;
    private _buildInProgress = false;
    private _buildVersion = 0;

    public constructor(name: string) {
        this.name = name;
    }

    public addOutputBlock(outputBlock: OutputBlock): void {
        this._throwIfDisposed();
        if (this._outputBlock !== undefined && this._outputBlock !== outputBlock) {
            throw new Error(`NodeAsset "${this.name}" supports only one output block in this version.`);
        }

        this._outputBlock = outputBlock;
    }

    public async buildAsync(): Promise<void> {
        this._throwIfDisposed();
        if (this._buildInProgress) {
            throw new Error(`NodeAsset "${this.name}" cannot build because a build is already in progress.`);
        }

        this._buildInProgress = true;
        const buildVersion = ++this._buildVersion;
        const outputBlock = this._outputBlock;
        let ownsOutputBuild = false;
        try {
            if (outputBlock === undefined) {
                throw new Error(`NodeAsset "${this.name}" cannot build because no output block has been registered.`);
            }

            const state = new AssetGraphBuildState();
            outputBlock._assertBuildAvailable(state);
            ownsOutputBuild = true;
            state._assertGraphValid(outputBlock, this.name);
            outputBlock._clearData();
            await state.buildBlockAsync(outputBlock);
            this._throwIfBuildWasDisposed(buildVersion);
        } catch (error) {
            if (outputBlock !== undefined && ownsOutputBuild) {
                outputBlock._clearData();
            }
            throw error;
        } finally {
            this._buildInProgress = false;
        }
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._buildVersion += 1;
        if (this._outputBlock !== undefined) {
            this._outputBlock._clearData();
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
