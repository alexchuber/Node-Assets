import type { Scene as BabylonScene } from "@babylonjs/core/scene";

import { Block, type BlockOptions } from "../block";
import { defineBlock } from "../blockDefinition";
import { BabylonSceneType } from "../../connectionTypes/babylon";
import { GlbType } from "../../connectionTypes/gltf";

const GLBOutputBlockDefinition = defineBlock({
    type: "gltf.output-glb",
    input: BabylonSceneType,
    output: GlbType,
    runAsync: serializeGlbAsync,
});

export class GLBOutputBlock extends Block<typeof GLBOutputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GLBOutputBlockDefinition>) {
        super(GLBOutputBlockDefinition, options);
    }
}

async function serializeGlbAsync(scene: BabylonScene): Promise<Uint8Array> {
    const { GLTF2Export } = await import("@babylonjs/serializers/glTF/2.0/glTFSerializer");
    const fileName = "scene.glb";
    const result = await GLTF2Export.GLBAsync(scene, fileName);
    const root = result.files[fileName];
    if (!(root instanceof Blob)) {
        throw new Error(`The Babylon glTF serializer did not produce "${fileName}".`);
    }
    return new Uint8Array(await root.arrayBuffer());
}
