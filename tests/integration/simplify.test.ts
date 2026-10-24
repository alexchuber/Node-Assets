import { expect, it } from "vitest";

import { NodeAsset, SimplifyBlock } from "../../packages/core/src/index";
import { createGridDocument } from "../helpers/document";

it("reduces triangle counts within the configured ratio and error", async () => {
    const document = createGridDocument();
    const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const originalCount = primitive.getIndices()!.getCount();
    expect(await new NodeAsset({ name: "simplify", outputBlock: new SimplifyBlock({ input: document, ratio: 0.5, error: 0.1, lockBorder: true }) }).executeAsync()).toBe(document);
    expect(primitive.getIndices()!.getCount()).toBeLessThan(originalCount);
    expect(primitive.getIndices()!.getCount()).toBeLessThanOrEqual(originalCount * 0.5);
});
