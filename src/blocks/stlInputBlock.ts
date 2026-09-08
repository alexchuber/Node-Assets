import { Block, type BlockOptions } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, UrlType } from "../block/connectionPointType";
import { NullEngineResource } from "../resources/nullEngineResource";
import { loadSingleFileSceneWithPluginAsync } from "./loadSceneWithPlugin";

const StlInputBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "input.stl",
    input: UrlType,
    output: BabylonSceneType,
    resources: {
        engine: NullEngineResource,
    },
    runAsync: (url, _config, { engine }) => loadSingleFileSceneWithPluginAsync(url, engine, ".stl", () => import("@babylonjs/loaders/STL/index.js")),
});

/** Loads an STL URL into a Babylon.js scene. */
export class StlInputBlock extends Block<typeof StlInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof StlInputBlockDefinition>) {
        super(StlInputBlockDefinition, options);
    }
}
