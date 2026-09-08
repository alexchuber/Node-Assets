import { Block, type BlockOptions } from "../block/block";
import { defineBlock } from "../block/blockDefinition";
import { BabylonSceneType, UrlType } from "../block/connectionPointType";
import { NullEngineResource } from "../resources/nullEngineResource";

const GltfInputBlockDefinition = /* @__PURE__ */ defineBlock({
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

        const abortController = new AbortController();
        try {
            const response = await fetchOrThrowAsync(url, abortController.signal);
            const resolvedUrl = response.url || url;
            const format = await readGltfResponseAsync(response, resolvedUrl);

            return await LoadSceneAsync(format.source, engine, {
                rootUrl: new URL(".", resolvedUrl).href,
                pluginExtension: format.extension,
                name: new URL(resolvedUrl).pathname.split("/").pop() ?? "",
                pluginOptions: {
                    gltf: {
                        preprocessUrlAsync: (dependencyUrl) => fetchAsDataUriAsync(dependencyUrl, abortController.signal),
                    },
                },
            });
        } finally {
            abortController.abort();
        }
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

async function fetchOrThrowAsync(url: string, signal: AbortSignal): Promise<Response> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Failed to fetch "${url}": HTTP ${response.status} ${response.statusText}`.trim());
    }
    return response;
}

interface GltfResponse {
    readonly extension: ".gltf" | ".glb";
    readonly source: string | Uint8Array;
}

async function readGltfResponseAsync(response: Response, url: string): Promise<GltfResponse> {
    const extension = tryGetGltfExtension(url) ?? getGltfExtensionFromContentType(response.headers.get("content-type"));
    if (extension === ".glb") {
        return { extension, source: new Uint8Array(await response.arrayBuffer()) };
    }
    if (extension === ".gltf") {
        return { extension, source: `data:${await response.text()}` };
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (isGlb(data)) {
        return { extension: ".glb", source: data };
    }
    const json = new TextDecoder().decode(data);
    if (isGltfJson(json)) {
        return { extension: ".gltf", source: `data:${json}` };
    }
    throw new Error(`Unable to determine the glTF format from "${url}".`);
}

function tryGetGltfExtension(url: string): ".gltf" | ".glb" | undefined {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".glb")) {
        return ".glb";
    }
    if (pathname.endsWith(".gltf")) {
        return ".gltf";
    }
    return undefined;
}

function getGltfExtensionFromContentType(contentType: string | null): ".gltf" | ".glb" | undefined {
    switch (contentType?.split(";", 1)[0]?.trim().toLowerCase()) {
        case "model/gltf-binary":
            return ".glb";
        case "model/gltf+json":
        case "application/json":
            return ".gltf";
        default:
            return undefined;
    }
}

function isGlb(data: Uint8Array): boolean {
    return data.byteLength >= 4 && data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x46;
}

function isGltfJson(json: string): boolean {
    try {
        const parsed = JSON.parse(json) as { asset?: { version?: unknown } };
        return typeof parsed.asset?.version === "string";
    } catch {
        return false;
    }
}

async function fetchAsDataUriAsync(url: string, signal: AbortSignal): Promise<string> {
    if (!isHttpUrl(url)) {
        return url;
    }

    const response = await fetchOrThrowAsync(url, signal);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream";
    const data = new Uint8Array(await response.arrayBuffer());
    return `data:${contentType};base64,${toBase64(data)}`;
}

function toBase64(data: Uint8Array): string {
    if (typeof Buffer === "function") {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
    }

    const chunkSize = 32_768;
    let binary = "";
    for (let offset = 0; offset < data.length; offset += chunkSize) {
        binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}
