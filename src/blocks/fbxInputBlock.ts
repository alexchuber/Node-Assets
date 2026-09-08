import { Block, type BlockOptions } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, UrlType } from "../block/connectionPointType";
import { NullEngineResource } from "../resources/nullEngineResource";
import { loadSingleFileSceneWithPluginAsync } from "./loadSceneWithPlugin";

const FbxInputBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "input.fbx",
    input: UrlType,
    output: BabylonSceneType,
    resources: {
        engine: NullEngineResource,
    },
    runAsync: (url, _config, { engine }) => loadSingleFileSceneWithPluginAsync(url, engine, ".fbx", () => import("@babylonjs/loaders/FBX/index.js")),
});

/** Loads an FBX URL into a Babylon.js scene. */
export class FbxInputBlock extends Block<typeof FbxInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof FbxInputBlockDefinition>) {
        super(FbxInputBlockDefinition, options);
    }
}
