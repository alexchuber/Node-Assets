import { describe, expect, it, vi } from "vitest";

import { FbxInputBlock, GltfOutputBlock, NodeAsset, NodeAssetContext } from "../../src/index";
import { generateFbxData, generateFbxDataUri } from "../helpers/fbx";
import { parseGlbAsync } from "../helpers/glb";

describe("FBX input", () => {
    it("loads generated FBX data without relying on a URL extension", async () => {
        const { json } = await parseGlbAsync(await roundTripAsync(new FbxInputBlock({ input: generateFbxDataUri() })));

        expect(json.meshes).toHaveLength(1);
        expect(json.meshes?.[0]?.primitives).toHaveLength(1);
    });

    it("loads an extensionless HTTP asset", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(generateFbxData())))
        );

        try {
            const { json } = await parseGlbAsync(await roundTripAsync(new FbxInputBlock({ input: "https://example.com/model" })));

            expect(json.meshes).toHaveLength(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("accepts input through an execution context", async () => {
        const source = new FbxInputBlock();
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);
        const asset = new NodeAsset({ name: "context-fbx-to-glb", outputBlock: destination });
        const context = new NodeAssetContext(asset);
        context.setInput(source, generateFbxDataUri());

        const { json } = await parseGlbAsync(await asset.executeAsync(context));

        expect(json.meshes).toHaveLength(1);
    });
});

async function roundTripAsync(source: FbxInputBlock): Promise<File> {
    const destination = new GltfOutputBlock();
    source.output.connectTo(destination.input);
    return new NodeAsset({ name: "fbx-roundtrip", outputBlock: destination }).executeAsync();
}
