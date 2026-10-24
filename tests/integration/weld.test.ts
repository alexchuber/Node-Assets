import { Document } from "@gltf-transform/core";
import { expect, it } from "vitest";

import { NodeAsset, WeldBlock } from "../../packages/core/src/index";

it("welds identical unindexed vertices", async () => {
    const document = new Document();
    const position = document
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]))
        .setBuffer(document.createBuffer());
    const primitive = document.createPrimitive().setAttribute("POSITION", position);
    document.createMesh().addPrimitive(primitive);
    await new NodeAsset({ name: "weld", outputBlock: new WeldBlock({ input: document }) }).executeAsync();
    expect(primitive.getAttribute("POSITION")?.getCount()).toBe(3);
    expect(primitive.getIndices()?.getCount()).toBe(6);
});
