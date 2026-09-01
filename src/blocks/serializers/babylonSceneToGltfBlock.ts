import { TransformBlock, type BlockOptions } from "../block";
import { defineTransformBlock, enumValue } from "../blockDefinition";
import { BabylonSceneType, GltfArtifactType } from "../../gltfValues";
import { PayloadKind, RepresentationKind, type BabylonScene, type GltfArtifact } from "../../connectionValues";
import { defineResource, resource } from "../../resources/resource";

export type GltfContainer = "gltf" | "glb";

type SerializeBabylon = (value: BabylonScene, container: GltfContainer) => Promise<GltfArtifact>;

export const GltfSerializerResource = defineResource<SerializeBabylon>({
    id: "babylon.gltf-serializer",
    createAsync: async () => {
        const { GLTF2Export } = await import("@babylonjs/serializers/glTF/2.0/glTFSerializer");

        return async (value, container) => {
            const fileName = container === "glb" ? "scene.glb" : "scene.gltf";
            const result = container === "glb" ? await GLTF2Export.GLBAsync(value.scene, fileName) : await GLTF2Export.GLTFAsync(value.scene, fileName);
            const root = result.files[fileName];
            if (root === undefined) {
                throw new Error(`The Babylon glTF serializer did not produce "${fileName}".`);
            }

            return {
                payloadKind: PayloadKind.Artifact,
                representationKind: RepresentationKind.GLTF,
                fileName,
                files: Object.freeze({ ...result.files }),
                data: typeof root === "string" ? new TextEncoder().encode(root) : new Uint8Array(await root.arrayBuffer()),
            };
        };
    },
});

export const SerializeBabylonToGltfBlockDefinition = defineTransformBlock({
    type: "babylon.serialize-gltf",
    input: BabylonSceneType,
    output: GltfArtifactType,
    config: {
        container: enumValue(["gltf", "glb"], "gltf"),
    },
    resources: {
        serializer: resource(GltfSerializerResource),
    },
    runAsync: (value, config, resources) => resources.serializer(value, config.container),
});

export class SerializeBabylonToGltfBlock extends TransformBlock<typeof SerializeBabylonToGltfBlockDefinition> {
    public constructor(options?: BlockOptions<typeof SerializeBabylonToGltfBlockDefinition>) {
        super(SerializeBabylonToGltfBlockDefinition, options);
    }
}
