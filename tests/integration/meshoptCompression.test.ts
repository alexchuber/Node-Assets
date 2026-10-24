import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { EncodeMeshoptBlock, GltfInputBlock, GltfOutputBlock, NodeAsset } from "../../packages/core/src/index";
import { parseGlbAsync } from "../helpers/glb";
import { generateGltfJson } from "../helpers/gltf";
import { createGridDocument } from "../helpers/document";

describe("Meshopt encoding", () => {
    it("preserves legacy meshopt({ encoder }) output byte for byte with default config", async () => {
        const block = new EncodeMeshoptBlock({ input: createGridDocument() });
        const output = new GltfOutputBlock();
        block.output.connectTo(output.input);
        const result = await new NodeAsset({ name: "legacy-meshopt", outputBlock: output }).executeAsync();
        // Captured from glTF Transform 4.5.0 meshopt({ encoder }), including its legacy I/O registration.
        expect(
            createHash("sha256")
                .update(new Uint8Array(await result.arrayBuffer()))
                .digest("hex")
        ).toBe("5289544067c881f2770a0bcdea7edffef98e1c0845a6cc1e15ae68794db0d773");
    });

    it("changes output with a non-default compression level", async () => {
        const encode = async (level: "medium" | "high"): Promise<File> => {
            const block = new EncodeMeshoptBlock({ input: createGridDocument(), level });
            const output = new GltfOutputBlock();
            block.output.connectTo(output.input);
            return new NodeAsset({ name: "meshopt-level", outputBlock: output }).executeAsync();
        };
        const high = await encode("high");
        const medium = await encode("medium");
        expect(new Uint8Array(await high.arrayBuffer())).not.toEqual(new Uint8Array(await medium.arrayBuffer()));
    });

    it("encodes connected glTF output", async () => {
        const url = "https://example.com/model.gltf";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateGltfJson())))
        );

        try {
            const source = new GltfInputBlock({ input: url });
            const encoder = new EncodeMeshoptBlock();
            const destination = new GltfOutputBlock();
            source.output.connectTo(encoder.input);
            encoder.output.connectTo(destination.input);

            const parsed = await parseGlbAsync(await new NodeAsset({ name: "meshopt-compressed-glb", outputBlock: destination }).executeAsync());

            expect(parsed.json.extensionsUsed).toContain("EXT_meshopt_compression");
            expect(parsed.json.bufferViews?.some(({ extensions }) => extensions?.EXT_meshopt_compression !== undefined)).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("decodes compressed input before an uncompressed round trip", async () => {
        const sourceUrl = "https://example.com/model.gltf";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateGltfJson())))
        );
        const source = new GltfInputBlock({ input: sourceUrl });
        const encoder = new EncodeMeshoptBlock();
        const compressedDestination = new GltfOutputBlock();
        source.output.connectTo(encoder.input);
        encoder.output.connectTo(compressedDestination.input);
        const compressed = await new NodeAsset({ name: "meshopt-source", outputBlock: compressedDestination }).executeAsync();

        const compressedUrl = "https://example.com/compressed.glb";
        vi.stubGlobal(
            "fetch",
            vi.fn(() => compressed.arrayBuffer().then((data) => new Response(data)))
        );
        try {
            const compressedSource = new GltfInputBlock({ input: compressedUrl });
            const destination = new GltfOutputBlock();
            compressedSource.output.connectTo(destination.input);

            const parsed = await parseGlbAsync(await new NodeAsset({ name: "decoded-meshopt", outputBlock: destination }).executeAsync());

            expect(parsed.json.extensionsUsed ?? []).not.toContain("EXT_meshopt_compression");
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
