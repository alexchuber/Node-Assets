import type { ConnectionPoint, ConnectionPointType, ConnectionPointValue } from "./connectionPoint";
import type { NodeAssetBlock } from "./blocks/nodeAssetBlock";
import type { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import type { SceneAsset } from "./sceneAsset";

/** @internal */
export class AssetGraphBuildState {
    private readonly _outputValues = new Map<ConnectionPoint<ConnectionPointType, "output">, ConnectionPointValue<ConnectionPointType>>();
    private readonly _blockBuilds = new Map<NodeAssetBlock, Promise<void>>();
    private readonly _sceneAssets = new Set<SceneAsset>();
    private readonly _fileRootUrls = new Map<Uint8Array, string>();
    private readonly _abortController = new AbortController();
    private readonly _graphName: string;
    private _disposed = false;

    /** @internal */
    public readonly _engine: NullEngine;
    /** @internal */
    public readonly _abortSignal: AbortSignal;

    public constructor(engine: NullEngine, graphName: string) {
        this._engine = engine;
        this._abortSignal = this._abortController.signal;
        this._graphName = graphName;
    }

    /** @internal */
    public _throwIfDisposed(): void {
        if (this._disposed) {
            throw this._getDisposalError();
        }
    }

    /** @internal */
    public _isDisposed(): boolean {
        return this._disposed;
    }

    /** @internal */
    public _getDisposalError(): Error {
        return new Error(`NodeAsset "${this._graphName}" was disposed while a build was in progress.`);
    }

    public async buildBlockAsync(block: NodeAssetBlock): Promise<void> {
        this._throwIfDisposed();
        block._assertBuildAvailable(this);
        const existingBuild = this._blockBuilds.get(block);
        if (existingBuild !== undefined) {
            await existingBuild;
            this._throwIfDisposed();
            return;
        }

        const build = block._buildWithStateAsync(this);
        this._blockBuilds.set(block, build);
        await build;
        this._throwIfDisposed();
    }

    public async resolveInputAsync<TType extends ConnectionPointType>(input: ConnectionPoint<TType, "input">): Promise<ConnectionPointValue<TType>> {
        this._throwIfDisposed();
        const output = input._getConnectedOutput();
        if (output !== undefined) {
            await this.buildBlockAsync(output._block);
        }

        this._throwIfDisposed();
        const value = output === undefined ? undefined : this._outputValues.get(output);
        if (value === undefined) {
            throw new Error(`Input connection point "${input._block.name}.${input.name}" did not produce a value during this build.`);
        }

        return value as ConnectionPointValue<TType>;
    }

    public setOutputValue<TType extends ConnectionPointType>(output: ConnectionPoint<TType, "output">, value: ConnectionPointValue<TType>): void {
        this._throwIfDisposed();
        this._outputValues.set(output, value);
    }

    /** @internal */
    public _setFileRootUrl(file: Uint8Array, rootUrl: string): void {
        this._throwIfDisposed();
        this._fileRootUrls.set(file, rootUrl);
    }

    /** @internal */
    public _getFileRootUrl(file: Uint8Array): string | undefined {
        this._throwIfDisposed();
        return this._fileRootUrls.get(file);
    }

    /** @internal */
    public _trackSceneAsset(sceneAsset: SceneAsset): void {
        this._throwIfDisposed();
        this._sceneAssets.add(sceneAsset);
    }

    /** @internal */
    public _dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        try {
            this._abortController.abort(this._getDisposalError());
        } finally {
            try {
                for (const sceneAsset of this._sceneAssets) {
                    sceneAsset._dispose();
                }
            } finally {
                this._sceneAssets.clear();
                this._blockBuilds.clear();
                this._outputValues.clear();
                this._fileRootUrls.clear();
                this._engine.dispose();
            }
        }
    }
}
