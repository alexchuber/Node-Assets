import type { Scene as BabylonSceneObject } from "@babylonjs/core/scene";

import { Block, type BlockOptions } from "../block";
import { defineBlock } from "../blockDefinition";
import { BabylonSceneType, UrlType } from "../../connectionPointType";

const GltfInputBlockDefinition = defineBlock({
    type: "input.gltf",
    input: UrlType,
    output: BabylonSceneType,
    runAsync: loadGltfAsync,
});

/** Loads a glTF or GLB URL into a Babylon.js scene. */
export class GltfInputBlock extends Block<typeof GltfInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GltfInputBlockDefinition>) {
        super(GltfInputBlockDefinition, options);
    }
}

async function loadGltfAsync(url: string): Promise<BabylonSceneObject> {
    await import("@babylonjs/loaders/glTF");
    const [{ LoadSceneAsync }, { NullEngine }] = await Promise.all([import("@babylonjs/core/Loading/sceneLoader"), import("@babylonjs/core/Engines/nullEngine")]);
    const engine = new NullEngine();
    try {
        const scene = await LoadSceneAsync(url, engine);
        return scene;
    } catch (error) {
        engine.dispose();
        throw error;
    }
}
