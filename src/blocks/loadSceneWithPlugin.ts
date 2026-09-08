import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { LoadOptions } from "@babylonjs/core/Loading/sceneLoader.js";
import type { Scene } from "@babylonjs/core/scene.js";

type SceneSource = string | ArrayBufferView;

export async function loadSceneWithPluginAsync(source: SceneSource, engine: AbstractEngine, loadPluginAsync: () => Promise<unknown>, options?: LoadOptions): Promise<Scene> {
    const [{ LoadSceneAsync }] = await Promise.all([import("@babylonjs/core/Loading/sceneLoader.js"), loadPluginAsync()]);
    return LoadSceneAsync(source, engine, options);
}

export async function loadSingleFileSceneWithPluginAsync(url: string, engine: AbstractEngine, pluginExtension: string, loadPluginAsync: () => Promise<unknown>): Promise<Scene> {
    if (!isHttpUrl(url)) {
        return loadSceneWithPluginAsync(url, engine, loadPluginAsync, { pluginExtension });
    }

    const abortController = new AbortController();
    try {
        const response = await fetchOrThrowAsync(url, abortController.signal);
        const resolvedUrl = response.url || url;
        const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream";
        const source = `data:${contentType};base64,${toBase64(new Uint8Array(await response.arrayBuffer()))}`;
        return await loadSceneWithPluginAsync(source, engine, loadPluginAsync, {
            rootUrl: new URL(".", resolvedUrl).href,
            pluginExtension,
            name: new URL(resolvedUrl).pathname.split("/").pop() ?? "",
        });
    } finally {
        abortController.abort();
    }
}

export function isHttpUrl(url: string): boolean {
    const scheme = url.slice(0, 8).toLowerCase();
    return scheme.startsWith("http://") || scheme.startsWith("https://");
}

export async function fetchOrThrowAsync(url: string, signal: AbortSignal): Promise<Response> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Failed to fetch "${url}": HTTP ${response.status} ${response.statusText}`.trim());
    }
    return response;
}

export function toBase64(data: Uint8Array): string {
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
