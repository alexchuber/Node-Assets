import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Scene } from "@babylonjs/core/scene.js";

export class SceneAsset {
    /** @internal */
    public readonly _scene: Scene;

    /** @internal */
    public readonly _assetContainer: AssetContainer;

    /** @internal */
    public constructor(scene: Scene, assetContainer: AssetContainer) {
        this._scene = scene;
        this._assetContainer = assetContainer;
    }
}
