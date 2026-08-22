import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Scene } from "@babylonjs/core/scene.js";

const sceneAssetBrand = Symbol("SceneAsset");

export class SceneAsset {
    #scene: Scene | undefined;
    #assetContainer: AssetContainer | undefined;
    #disposed = false;

    private constructor(token: symbol) {
        if (token !== sceneAssetBrand) {
            throw new Error("SceneAsset instances can only be created internally.");
        }
    }

    /** @internal */
    public static _create(scene: Scene): SceneAsset {
        const sceneAsset = new SceneAsset(sceneAssetBrand);
        sceneAsset.#scene = scene;
        return sceneAsset;
    }

    /** @internal */
    public _attachAssetContainer(assetContainer: AssetContainer): void {
        if (this.#disposed) {
            throw new Error("Cannot attach an asset container to a disposed SceneAsset.");
        }
        if (this.#assetContainer !== undefined) {
            throw new Error("A SceneAsset can only own one asset container.");
        }

        this.#assetContainer = assetContainer;
    }

    /** @internal */
    public _getScene(): Scene {
        if (this.#disposed || this.#scene === undefined) {
            throw new Error("Cannot access a disposed SceneAsset.");
        }

        return this.#scene;
    }

    /** @internal */
    public _dispose(): void {
        if (this.#disposed) {
            return;
        }

        this.#disposed = true;
        const scene = this.#scene;
        const assetContainer = this.#assetContainer;

        try {
            assetContainer?.dispose();
        } finally {
            try {
                scene?.dispose();
            } finally {
                this.#assetContainer = undefined;
                this.#scene = undefined;
            }
        }
    }
}
