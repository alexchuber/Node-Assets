import { describe, expect, it, vi } from "vitest";

import { GltfOutputBlock, NodeAsset, NodeAssetContext, StlInputBlock } from "../../src/index";
import { parseGlbAsync } from "../helpers/glb";
import { generateStlData, generateStlDataUri } from "../helpers/stl";

describe("STL input", () => {
    it("loads generated STL data without relying on a URL extension", async () => {
        const { json } = await parseGlbAsync(await roundTripAsync(new StlInputBlock({ input: generateStlDataUri() })));

        expect(json.meshes).toHaveLength(1);
        expect(json.meshes?.[0]?.primitives).toHaveLength(1);
    });

    it("loads an extensionless HTTP asset", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateStlData())))
        );

        try {
            const { json } = await parseGlbAsync(await roundTripAsync(new StlInputBlock({ input: "https://example.com/model" })));

            expect(json.meshes).toHaveLength(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("accepts input through an execution context", async () => {
        const source = new StlInputBlock();
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);
        const asset = new NodeAsset({ name: "context-stl-to-glb", outputBlock: destination });
        const context = new NodeAssetContext(asset);
        context.setInput(source, generateStlDataUri());

        const { json } = await parseGlbAsync(await asset.executeAsync(context));

        expect(json.meshes).toHaveLength(1);
    });
});

async function roundTripAsync(source: StlInputBlock): Promise<File> {
    const destination = new GltfOutputBlock();
    source.output.connectTo(destination.input);
    return new NodeAsset({ name: "stl-roundtrip", outputBlock: destination }).executeAsync();
}
