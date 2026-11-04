import type { ISceneLoaderPluginFactory, LoadOptions } from "@babylonjs/core/Loading/sceneLoader.js";

import { GltfDocumentType } from "../connectionPoints/gltfDocument";
import { UrlType } from "../connectionPoints/url";
import { convertBabylonSceneToDocumentAsync } from "../helpers/convertBabylonSceneToDocument";
import { loadSceneWithPluginAsync } from "../helpers/loadSceneWithPlugin";
import { NullEngineResource } from "../resources/nullEngineResource";
import { PlatformIOResource } from "../resources/platformIOResource";
import { defineBlock } from "./blockDefinition";

interface BabylonSceneInputBlockOptions {
    readonly type: string;
    readonly loaderFactory: ISceneLoaderPluginFactory;
    readonly loadOptions: LoadOptions;
}

export function defineBabylonSceneInputBlock({ type, loaderFactory, loadOptions }: BabylonSceneInputBlockOptions) {
    return defineBlock({
        type,
        input: UrlType,
        output: GltfDocumentType,
        resources: {
            engine: NullEngineResource,
            io: PlatformIOResource,
        },
        runAsync: async (url, _config, { engine, io }) => convertBabylonSceneToDocumentAsync(await loadSceneWithPluginAsync(url, engine, loaderFactory, loadOptions), io),
    });
}
