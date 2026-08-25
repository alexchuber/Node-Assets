import type { ConnectionPoint, ConnectionPointType, ConnectionPointValue } from "./connectionPoint";
import type { NodeAssetBlock } from "./blocks/nodeAssetBlock";
import type { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import type { SceneAsset } from "./sceneAsset";

/** @internal */
export interface AssetGraphValidation {
    readonly duplicateOutputNames: readonly string[];
    readonly details: readonly string[];
    readonly missingInputs: readonly {
        readonly block: NodeAssetBlock;
        readonly input: ConnectionPoint<ConnectionPointType, "input">;
    }[];
    readonly sceneAssetFanOuts: readonly {
        readonly block: NodeAssetBlock;
        readonly output: ConnectionPoint<ConnectionPointType, "output">;
    }[];
}

interface GraphValidationFinding {
    readonly kindRank: number;
    readonly producerName: string;
    readonly portName: string;
    readonly message: string;
}

function compareText(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

function compareGraphValidationFindings(left: GraphValidationFinding, right: GraphValidationFinding): number {
    return (
        left.kindRank - right.kindRank ||
        compareText(left.producerName, right.producerName) ||
        compareText(left.portName, right.portName) ||
        compareText(left.message, right.message)
    );
}

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

    /** @internal */
    public _validateGraph(roots: readonly NodeAssetBlock[]): AssetGraphValidation {
        this._throwIfDisposed();
        const nameCounts = new Map<string, number>();
        for (const root of roots) {
            nameCounts.set(root.name, (nameCounts.get(root.name) ?? 0) + 1);
        }
        const duplicateOutputNames = [...nameCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([name]) => name)
            .sort(compareText);
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

        const findings: GraphValidationFinding[] = [
            ...(duplicateOutputNames.length > 0
                ? [
                      {
                          kindRank: 0,
                          producerName: "",
                          portName: duplicateOutputNames.join(", "),
                          message: `Duplicate output block names: ${duplicateOutputNames.map((name) => `"${name}"`).join(", ")}.`,
                      },
                  ]
                : []),
            ...missingInputs.map(({ block, input }) => ({
                kindRank: 1,
                producerName: block.name,
                portName: input.name,
                message: `Block "${block.name}" has an unconnected required input "${input.name}".`,
            })),
            ...sceneAssetFanOuts.map(({ block, output }) => ({
                kindRank: 2,
                producerName: block.name,
                portName: output.name,
                message: `Block "${block.name}" output "${output.name}" produces a SceneAsset value that is moved to its consumer and cannot feed multiple consumers in v0.`,
            })),
        ];
        findings.sort(compareGraphValidationFindings);
        const details = findings.map(({ message }) => message);

        return { details, duplicateOutputNames, missingInputs, sceneAssetFanOuts };
    }

    /** @internal */
    public _assertGraphValid(roots: readonly NodeAssetBlock[], graphName: string): void {
        this._assertGraphValidationValid(this._validateGraph(roots), graphName);
    }

    /** @internal */
    public _assertGraphValidationValid(validation: AssetGraphValidation, graphName: string): void {
        this._throwIfDisposed();
        if (validation.details.length === 0) {
            return;
        }

        if (validation.duplicateOutputNames.length > 0 && validation.missingInputs.length === 0 && validation.sceneAssetFanOuts.length === 0) {
            const names = validation.duplicateOutputNames.map((name) => `"${name}"`).join(", ");
            throw new Error(`NodeAsset "${graphName}" has duplicate output block names: ${names}.`);
        }

        throw new Error(`NodeAsset "${graphName}" cannot build because the graph has structural errors:\n${validation.details.join("\n")}`);
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
