import { Document } from "@gltf-transform/core";
import { expect, it } from "vitest";

import { FlattenBlock, NodeAsset } from "../../packages/core/src/index";
import { createGridDocument } from "../helpers/document";

it("flattens a static hierarchy while preserving world transforms", async () => {
    const document = createGridDocument(1);
    const scene = document.getRoot().listScenes()[0]!;
    const child = scene.listChildren()[0]!.setTranslation([1, 0, 0]);
    scene.addChild(document.createNode().setTranslation([2, 0, 0]).addChild(child));
    await new NodeAsset({ name: "flatten", outputBlock: new FlattenBlock({ input: document }) }).executeAsync();
    expect(child.getParentNode()).toBeNull();
    expect(child.getWorldTranslation()).toEqual([3, 0, 0]);
});

it.each(["animation", "skin"])("does not flatten documents with a %s", async (kind) => {
    const document = new Document();
    const parent = document.createNode();
    const child = document.createNode();
    document.createScene().addChild(parent.addChild(child));
    if (kind === "animation") {
        document.createAnimation();
    } else {
        document.createSkin();
    }
    await new NodeAsset({ name: "protected-hierarchy", outputBlock: new FlattenBlock({ input: document }) }).executeAsync();
    expect(child.getParentNode()).toBe(parent);
});
