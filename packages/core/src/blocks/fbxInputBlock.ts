import type { ISceneLoaderPluginFactory } from "@babylonjs/core/Loading/sceneLoader.js";
import { FBXFileLoaderMetadata } from "@babylonjs/loaders/FBX/fbxFileLoader.metadata.js";

import { Block, type BlockOptions } from "./block";
import { defineBabylonSceneInputBlock } from "./babylonSceneInputBlock";

const FbxLoaderFactory = {
    ...FBXFileLoaderMetadata,
    createPlugin: async () => {
        const [{ RegisterStandardMaterial }, { FBXFileLoader }] = await Promise.all([
            import("@babylonjs/core/Materials/standardMaterial.pure.js"),
            import("@babylonjs/loaders/FBX/fbxFileLoader.pure.js"),
        ]);
        RegisterStandardMaterial();
        return new FBXFileLoader();
    },
} satisfies ISceneLoaderPluginFactory;

const FbxInputBlockDefinition = /* @__PURE__ */ defineBabylonSceneInputBlock({
    type: "input.fbx",
    loaderFactory: FbxLoaderFactory,
    loadOptions: {
        pluginExtension: ".fbx",
    },
});

/** Loads an FBX URL or Node filesystem path. */
export class FbxInputBlock extends Block<typeof FbxInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof FbxInputBlockDefinition>) {
        super(FbxInputBlockDefinition, options);
    }
}
