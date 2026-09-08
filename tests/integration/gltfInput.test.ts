import { describe, expect, it, vi } from "vitest";

import { GltfInputBlock, GltfOutputBlock, NodeAsset, NodeAssetContext } from "../../src/index";
import { parseGlbAsync } from "../helpers/glb";
import { generateGlbDataUri, generateGltfDataUri } from "../helpers/gltf";

describe("glTF input", () => {
    it.each([
        { format: "glTF", input: generateGltfDataUri() },
        { format: "GLB", input: generateGlbDataUri() },
    ])("accepts generated $format data", async ({ input }) => {
        await parseGlbAsync(await roundTripAsync(input));
    });

    it("accepts input through an execution context", async () => {
        const source = new GltfInputBlock();
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);
        const asset = new NodeAsset({ name: "context-gltf-to-glb", outputBlock: destination });
        const context = new NodeAssetContext(asset);
        context.setInput(source, generateGltfDataUri());

        await parseGlbAsync(await asset.executeAsync(context));
    });

    it.each([
        { contentType: "application/octet-stream", input: generateGltfDataUri(), url: "https://example.com/model.gltf" },
        { contentType: "application/octet-stream", input: generateGlbDataUri(), url: "https://example.com/model.glb" },
        { contentType: "model/gltf+json", input: generateGltfDataUri(), url: "https://example.com/model" },
        { contentType: "model/gltf-binary", input: generateGlbDataUri(), url: "https://example.com/model" },
        { contentType: "application/octet-stream", input: generateGltfDataUri(), url: "https://example.com/extensionless" },
        { contentType: "application/octet-stream", input: generateGlbDataUri(), url: "https://example.com/extensionless" },
    ])("detects an HTTP asset at $url with $contentType", async ({ contentType, input, url }) => {
        const responseBody = decodeDataUri(input);
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(responseBody, { headers: { "content-type": contentType } })))
        );

        try {
            await parseGlbAsync(await roundTripAsync(url));
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("aborts sibling HTTP dependency fetches after a dependency fails", async () => {
        const rootUrl = "https://example.com/model.gltf";
        const gltf = JSON.parse(generateGltfDataUri().slice("data:".length)) as {
            buffers: Array<{ byteLength: number; uri: string }>;
            bufferViews: Array<{ buffer: number; byteLength: number; byteOffset: number }>;
        };
        gltf.buffers = [
            { byteLength: 72, uri: "slow.bin" },
            { byteLength: 6, uri: "fail.bin" },
        ];
        gltf.bufferViews[2] = { buffer: 1, byteLength: 6, byteOffset: 0 };
        let slowFetchWasAborted = false;
        const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url === rootUrl) {
                return Promise.resolve(new Response(JSON.stringify(gltf), { headers: { "content-type": "model/gltf+json" } }));
            }
            if (url.endsWith("/fail.bin")) {
                return Promise.resolve(new Response("", { status: 500, statusText: "Failed" }));
            }
            if (url.endsWith("/slow.bin")) {
                return new Promise<Response>((_resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error("slow dependency was not aborted")), 100);
                    init?.signal?.addEventListener(
                        "abort",
                        () => {
                            clearTimeout(timeout);
                            slowFetchWasAborted = true;
                            reject(init.signal?.reason);
                        },
                        { once: true }
                    );
                });
            }
            return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        });
        vi.stubGlobal("fetch", fetchMock);

        try {
            const source = new GltfInputBlock({ input: rootUrl });
            await expect(new NodeAsset({ name: "failed-http-gltf", outputBlock: source }).executeAsync()).rejects.toThrow();
            expect(slowFetchWasAborted).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

async function roundTripAsync(input: string): Promise<File> {
    const source = new GltfInputBlock({ input });
    const destination = new GltfOutputBlock();
    source.output.connectTo(destination.input);
    return new NodeAsset({ name: "gltf-roundtrip", outputBlock: destination }).executeAsync();
}

function decodeDataUri(dataUri: string): string | ArrayBuffer {
    if (dataUri.startsWith("data:{")) {
        return dataUri.slice("data:".length);
    }

    const separator = dataUri.indexOf(",");
    const payload = dataUri.slice(separator + 1);
    if (!dataUri.slice(0, separator).endsWith(";base64")) {
        return payload;
    }
    return Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)).buffer;
}
