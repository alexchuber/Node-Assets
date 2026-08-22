import type { ConnectionPoint, ConnectionPointType, ConnectionPointValue } from "./connectionPoint";
import type { NodeAssetBlock } from "./nodeAssetBlock";
import type { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import type { SceneAsset } from "./sceneAsset";

/** @internal */
export class AssetGraphBuildState {
    private readonly _outputValues = new Map<ConnectionPoint<ConnectionPointType, "output">, ConnectionPointValue<ConnectionPointType>>();
    private readonly _sceneAssets = new Set<SceneAsset>();

    /** @internal */
    public readonly _engine: NullEngine;

    public constructor(engine: NullEngine) {
        this._engine = engine;
    }

    public async buildBlockAsync(block: NodeAssetBlock): Promise<void> {
        await block._buildWithStateAsync(this);
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
    public _trackSceneAsset(sceneAsset: SceneAsset): void {
        this._sceneAssets.add(sceneAsset);
    }

    /** @internal */
    public _dispose(): void {
        try {
            for (const sceneAsset of this._sceneAssets) {
                sceneAsset._dispose();
            }
        } finally {
            this._sceneAssets.clear();
            this._outputValues.clear();
        }
    }
}
