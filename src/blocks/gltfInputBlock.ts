import { Block, type BlockOptions } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, UrlType } from "../block/connectionPointType";
import { NullEngineResource } from "../resources/nullEngineResource";

const GltfInputBlockDefinition = defineBlock({
    type: "input.gltf",
    input: UrlType,
    output: BabylonSceneType,
    resources: {
        engine: NullEngineResource,
    },
    runAsync: async (url, _config, { engine }) => {
        const [{ LoadSceneAsync }] = await Promise.all([import("@babylonjs/core/Loading/sceneLoader.js"), import("@babylonjs/loaders/glTF/index.js")]);

        if (!isHttpUrl(url)) {
            return LoadSceneAsync(url, engine);
        }

        const response = await fetchOrThrowAsync(url);
        const resolvedUrl = response.url || url;
        const extension = getGltfExtension(resolvedUrl);
        const source = extension === ".glb" ? new Uint8Array(await response.arrayBuffer()) : `data:${await response.text()}`;

        return LoadSceneAsync(source, engine, {
            rootUrl: new URL(".", resolvedUrl).href,
            pluginExtension: extension,
            name: new URL(resolvedUrl).pathname.split("/").pop() ?? "",
            pluginOptions: {
                gltf: {
                    preprocessUrlAsync: fetchAsDataUriAsync,
                },
            },
        });
    },
});

/** Loads a glTF or GLB URL into a Babylon.js scene. */
export class GltfInputBlock extends Block<typeof GltfInputBlockDefinition> {
    public constructor(options?: BlockOptions<typeof GltfInputBlockDefinition>) {
        super(GltfInputBlockDefinition, options);
    }
}

function isHttpUrl(url: string): boolean {
    const scheme = url.slice(0, 8).toLowerCase();
    return scheme.startsWith("http://") || scheme.startsWith("https://");
}

async function fetchOrThrowAsync(url: string): Promise<Response> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch "${url}": HTTP ${response.status} ${response.statusText}`.trim());
    }
    return response;
}

function getGltfExtension(url: string): ".gltf" | ".glb" {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".glb")) {
        return ".glb";
    }
    if (pathname.endsWith(".gltf")) {
        return ".gltf";
    }
    throw new Error(`Unable to determine the glTF format from "${url}".`);
}

async function fetchAsDataUriAsync(url: string): Promise<string> {
    if (!isHttpUrl(url)) {
        return url;
    }

    const response = await fetchOrThrowAsync(url);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream";
    const data = new Uint8Array(await response.arrayBuffer());
    return `data:${contentType};base64,${toBase64(data)}`;
}

function toBase64(data: Uint8Array): string {
    const chunkSize = 32_768;
    let binary = "";
    for (let offset = 0; offset < data.length; offset += chunkSize) {
        binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}
