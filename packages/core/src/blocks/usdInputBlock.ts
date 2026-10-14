import type { ISceneLoaderPluginFactory } from "@babylonjs/core/Loading/sceneLoader.js";
import { USDFileLoaderMetadata } from "@babylonjs/loaders/USD/usdFileLoader.metadata.js";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { UrlType } from "../connectionPoints/url";
import { convertBabylonSceneToDocumentAsync } from "../helpers/convertBabylonSceneToDocument";
import { resolveInputLocationAsync } from "../helpers/inputLocation";
import { loadSceneWithPluginAsync } from "../helpers/loadSceneWithPlugin";
import { NullEngineResource } from "../resources/nullEngineResource";
import { PlatformIOResource } from "../resources/platformIOResource";
import { Block, type BlockOptions } from "./block";
import { defineBlock } from "./blockDefinition";

const UsdLoaderFactory = {
    ...USDFileLoaderMetadata,
    createPlugin: async () => {
        const [{ USDFileLoader, _RegisterUSDLoaderDependencies }, { default: runtimeUrls }] = await Promise.all([
            import("@babylonjs/loaders/USD/usdFileLoader.pure.js"),
            import("virtual:node-assets-usd-runtime-urls"),
        ]);
        _RegisterUSDLoaderDependencies();
        // Emscripten's Node data loader passes this URL straight to fs.readFileSync, which rejects file URL strings.
        const { path: dataPath } = await resolveInputLocationAsync(runtimeUrls.dataUrl);
        return new USDFileLoader({ ...runtimeUrls, dataUrl: dataPath ?? runtimeUrls.dataUrl });
    },
} satisfies ISceneLoaderPluginFactory;

const UsdInputBlockDefinition = /* @__PURE__ */ defineBlock({
    type: "input.usd",
    input: UrlType,
    output: GltfDocumentType,
    resources: {
        engine: NullEngineResource,
        io: PlatformIOResource,
    },
    runAsync: async (url, _config, { engine, io }) =>
        convertBabylonSceneToDocumentAsync(
            await loadSceneWithPluginAsync(url, engine, UsdLoaderFactory, {
                pluginExtension: ".usd",
            }),
            io
        ),
});

/** Loads a USD, USDA, USDC, or USDZ URL or Node filesystem path; requires Web Worker support. */
export class UsdInputBlock extends Block<typeof UsdInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof UsdInputBlockDefinition>) {
        super(UsdInputBlockDefinition, options);
    }
}
