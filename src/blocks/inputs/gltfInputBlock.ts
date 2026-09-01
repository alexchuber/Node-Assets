import type { Scene as BabylonSceneObject } from "@babylonjs/core/scene";

import { Block, type BlockOptions } from "../block";
import { defineBlock } from "../blockDefinition";
import { BabylonSceneType } from "../../connectionTypes/babylon";
import { GlbType, GltfSourceType } from "../../connectionTypes/gltf";

const GltfInputBlockDefinition = defineBlock({
    type: "gltf.input",
    input: GltfSourceType,
    output: BabylonSceneType,
    runAsync: loadGltfAsync,
});

export class GltfInputBlock extends Block<typeof GltfInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GltfInputBlockDefinition>) {
        super(GltfInputBlockDefinition, options);
    }
}

async function loadGltfAsync(data: Uint8Array): Promise<BabylonSceneObject> {
    await import("@babylonjs/loaders/glTF");
    const [{ LoadSceneAsync }, { NullEngine }] = await Promise.all([import("@babylonjs/core/Loading/sceneLoader"), import("@babylonjs/core/Engines/nullEngine")]);
    const engine = new NullEngine();
    try {
        const binary = GlbType.is(data);
        const source = binary ? data : `data:${new TextDecoder().decode(data)}`;
        const scene = await LoadSceneAsync(source, engine, {
            name: binary ? "scene.glb" : "scene.gltf",
            pluginExtension: binary ? ".glb" : ".gltf",
        });
        return scene;
    } catch (error) {
        engine.dispose();
        throw error;
    }
}
