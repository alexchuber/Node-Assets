import type { ISceneLoaderPluginFactory } from "@babylonjs/core/Loading/sceneLoader.js";
import { STLFileLoaderMetadata } from "@babylonjs/loaders/STL/stlFileLoader.metadata.js";

import { Block, type BlockOptions } from "./block";
import { defineBabylonSceneInputBlock } from "./babylonSceneInputBlock";

const StlLoaderFactory = {
    ...STLFileLoaderMetadata,
    createPlugin: async () => {
        const [{ RegisterStandardMaterial }, { STLFileLoader }] = await Promise.all([
            import("@babylonjs/core/Materials/standardMaterial.pure.js"),
            import("@babylonjs/loaders/STL/stlFileLoader.pure.js"),
        ]);
        RegisterStandardMaterial();
        return new STLFileLoader();
    },
} satisfies ISceneLoaderPluginFactory;

const StlInputBlockDefinition = /* @__PURE__ */ defineBabylonSceneInputBlock({
    type: "input.stl",
    loaderFactory: StlLoaderFactory,
    loadOptions: {
        pluginExtension: ".stl",
    },
});

/** Loads an STL URL or Node filesystem path. */
export class StlInputBlock extends Block<typeof StlInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof StlInputBlockDefinition>) {
        super(StlInputBlockDefinition, options);
    }
}
