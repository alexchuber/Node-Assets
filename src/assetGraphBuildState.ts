import type { ConnectionPoint, ConnectionPointType, ConnectionPointValue } from "./connectionPoint";
import type { NodeAssetBlock } from "./nodeAssetBlock";
import type { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import type { SceneAsset } from "./sceneAsset";

/** @internal */
export interface AssetGraphValidation {
    readonly missingInputs: readonly {
        readonly block: NodeAssetBlock;
        readonly input: ConnectionPoint<ConnectionPointType, "input">;
    }[];
    readonly sceneAssetFanOuts: readonly {
        readonly block: NodeAssetBlock;
        readonly output: ConnectionPoint<ConnectionPointType, "output">;
    }[];
}

/** @internal */
export class AssetGraphBuildState {
    private readonly _outputValues = new Map<ConnectionPoint<ConnectionPointType, "output">, ConnectionPointValue<ConnectionPointType>>();
    private readonly _blockBuilds = new Map<NodeAssetBlock, Promise<void>>();
    private readonly _sceneAssets = new Set<SceneAsset>();
    private readonly _fileRootUrls = new Map<Uint8Array, string>();
    private readonly _abortController = new AbortController();

    /** @internal */
    public readonly _engine: NullEngine;

    /** @internal */
    public readonly _abortSignal: AbortSignal;

    public constructor(engine: NullEngine) {
        this._engine = engine;
        this._abortSignal = this._abortController.signal;
    }

    /** @internal */
    public _validateGraph(roots: readonly NodeAssetBlock[]): AssetGraphValidation {
        const missingInputs: Array<{ block: NodeAssetBlock; input: ConnectionPoint<ConnectionPointType, "input"> }> = [];
        const sceneAssetFanOuts: Array<{ block: NodeAssetBlock; output: ConnectionPoint<ConnectionPointType, "output"> }> = [];
        const visitedBlocks = new Set<NodeAssetBlock>();

        const visit = (block: NodeAssetBlock): void => {
            if (visitedBlocks.has(block)) {
                return;
            }

            visitedBlocks.add(block);
            for (const input of block._getInputs()) {
                const output = input._getConnectedOutput();
                if (output === undefined) {
                    missingInputs.push({ block, input });
                    continue;
                }

                visit(output._block);
            }

            for (const output of block._getOutputs()) {
                if (output.type === "SceneAsset" && output._getEndpoints().length > 1) {
                    sceneAssetFanOuts.push({ block, output });
                }
            }
        };

        for (const root of roots) {
            visit(root);
        }

        return { missingInputs, sceneAssetFanOuts };
    }

    /** @internal */
    public _assertGraphValid(roots: readonly NodeAssetBlock[], graphName: string): void {
        this._assertGraphValidationValid(this._validateGraph(roots), graphName);
    }

    /** @internal */
    public _assertGraphValidationValid(validation: AssetGraphValidation, graphName: string): void {
        const details = [
            ...validation.missingInputs.map(({ block, input }) => `Block "${block.name}" has an unconnected required input "${input.name}".`),
            ...validation.sceneAssetFanOuts.map(
                ({ block, output }) =>
                    `Block "${block.name}" output "${output.name}" produces a SceneAsset value that is moved to its consumer and cannot feed multiple consumers in v0.`
            ),
        ];

        if (details.length > 0) {
            throw new Error(`NodeAsset "${graphName}" cannot build because the graph has structural errors:\n${details.join("\n")}`);
        }
    }

    public async buildBlockAsync(block: NodeAssetBlock): Promise<void> {
        block._assertBuildAvailable(this);
        const existingBuild = this._blockBuilds.get(block);
        if (existingBuild !== undefined) {
            await existingBuild;
            return;
        }

        const build = block._buildWithStateAsync(this);
        this._blockBuilds.set(block, build);
        await build;
    }

    public async resolveInputAsync<TType extends ConnectionPointType>(input: ConnectionPoint<TType, "input">): Promise<ConnectionPointValue<TType>> {
        const output = input._getConnectedOutput();
        if (output !== undefined) {
            await this.buildBlockAsync(output._block);
        }

        const value = output === undefined ? undefined : this._outputValues.get(output);
        if (value === undefined) {
            throw new Error(`Input connection point "${input._block.name}.${input.name}" did not produce a value during this build.`);
        }

        return value as ConnectionPointValue<TType>;
    }

    public setOutputValue<TType extends ConnectionPointType>(output: ConnectionPoint<TType, "output">, value: ConnectionPointValue<TType>): void {
        this._outputValues.set(output, value);
    }

    /** @internal */
    public _setFileRootUrl(file: Uint8Array, rootUrl: string): void {
        this._fileRootUrls.set(file, rootUrl);
    }

    /** @internal */
    public _getFileRootUrl(file: Uint8Array): string | undefined {
        return this._fileRootUrls.get(file);
    }

    /** @internal */
    public _trackSceneAsset(sceneAsset: SceneAsset): void {
        this._sceneAssets.add(sceneAsset);
    }

    /** @internal */
    public _dispose(): void {
        try {
            this._abortController.abort();
            for (const sceneAsset of this._sceneAssets) {
                sceneAsset._dispose();
            }
        } finally {
            this._sceneAssets.clear();
            this._outputValues.clear();
            this._fileRootUrls.clear();
        }
    }
}
