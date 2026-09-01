import type { Scene as BabylonSceneObject } from "@babylonjs/core/scene";

import { TransformBlock, type BlockOptions } from "../block";
import { defineTransformBlock, enumValue } from "../blockDefinition";
import { BabylonSceneType, GltfBytesType } from "../../gltfValues";
import { PayloadKind, RepresentationKind, type BabylonScene } from "../../connectionValues";
import { defineResource, resource } from "../../resources/resource";

export type GltfContainer = "gltf" | "glb";

type ParseGltf = (data: Uint8Array, container: GltfContainer) => Promise<BabylonScene>;

export const GltfParserResource = defineResource<ParseGltf>({
    id: "babylon.gltf-parser",
    createAsync: async () => {
        await import("@babylonjs/loaders/glTF");
        const [{ LoadSceneAsync }, { NullEngine }] = await Promise.all([import("@babylonjs/core/Loading/sceneLoader"), import("@babylonjs/core/Engines/nullEngine")]);

        return async (data, container) => {
            const engine = new NullEngine();
            try {
                const isBinary = container === "glb";
                const source = isBinary ? data : `data:${new TextDecoder().decode(data)}`;
                const scene = await LoadSceneAsync(source, engine, {
                    name: isBinary ? "scene.glb" : "scene.gltf",
                    pluginExtension: isBinary ? ".glb" : ".gltf",
                });
                return createBabylonScene(scene);
            } catch (error) {
                engine.dispose();
                throw error;
            }
        };
    },
});

export const GltfToBabylonSceneBlockDefinition = defineTransformBlock({
    type: "babylon.parse-gltf",
    input: GltfBytesType,
    output: BabylonSceneType,
    config: {
        container: enumValue(["gltf", "glb"], "gltf"),
    },
    resources: {
        parser: resource(GltfParserResource),
    },
    runAsync: (data, config, resources) => resources.parser(data, config.container),
});

export class GltfToBabylonSceneBlock extends TransformBlock<typeof GltfToBabylonSceneBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GltfToBabylonSceneBlockDefinition>) {
        super(GltfToBabylonSceneBlockDefinition, options);
    }
}

function createBabylonScene(scene: BabylonSceneObject): BabylonScene {
    return {
        payloadKind: PayloadKind.Scene,
        representationKind: RepresentationKind.Babylon,
        scene,
    };
}
