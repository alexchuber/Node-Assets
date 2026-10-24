import { Document } from "@gltf-transform/core";
import { expect, it } from "vitest";

import { DedupBlock, NodeAsset } from "../../packages/core/src/index";

it("deduplicates identical materials", async () => {
    const document = new Document();
    const first = document.createPrimitive().setMaterial(document.createMaterial());
    const second = document.createPrimitive().setMaterial(document.createMaterial());
    document.createMesh().addPrimitive(first).addPrimitive(second);
    const result = await new NodeAsset({ name: "dedup", outputBlock: new DedupBlock({ input: document }) }).executeAsync();
    expect(result).toBe(document);
    expect(document.getRoot().listMaterials()).toHaveLength(1);
    expect(first.getMaterial()).toBe(second.getMaterial());
});
