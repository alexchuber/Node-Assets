import type { ISceneLoaderPluginFactory } from "@babylonjs/core/Loading/sceneLoader.js";
import { OBJFileLoaderMetadata } from "@babylonjs/loaders/OBJ/objFileLoader.metadata.js";

import { Block, type BlockOptions } from "./block";
import { defineBabylonSceneInputBlock } from "./babylonSceneInputBlock";

const ObjLoaderFactory = {
    ...OBJFileLoaderMetadata,
    createPlugin: async (options) => {
        const { OBJFileLoader } = await import("@babylonjs/loaders/OBJ/objFileLoader.pure.js");
        return new OBJFileLoader(options.obj);
    },
} satisfies ISceneLoaderPluginFactory;

const ObjInputBlockDefinition = /* @__PURE__ */ defineBabylonSceneInputBlock({
    type: "input.obj",
    loaderFactory: ObjLoaderFactory,
    loadOptions: {
        pluginExtension: ".obj",
        pluginOptions: { obj: { materialLoadingFailsSilently: false } },
    },
});

/** Loads an OBJ URL or Node filesystem path using Babylon's dependency resolution. */
export class ObjInputBlock extends Block<typeof ObjInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof ObjInputBlockDefinition>) {
        super(ObjInputBlockDefinition, options);
    }
}
