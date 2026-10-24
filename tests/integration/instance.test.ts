import { EXTMeshGPUInstancing, type InstancedMesh } from "@gltf-transform/extensions";
import { expect, it } from "vitest";

import { GltfOutputBlock, InstanceBlock, NodeAsset } from "../../packages/core/src/index";
import { createGridDocument } from "../helpers/document";
import { parseGlbAsync } from "../helpers/glb";

it("instances shared meshes at the configured minimum and writes the extension", async () => {
    const document = createGridDocument(1);
    const scene = document.getRoot().listScenes()[0]!;
    scene.addChild(document.createNode().setMesh(document.getRoot().listMeshes()[0]!).setTranslation([2, 0, 0]));
    const block = new InstanceBlock({ input: document, min: 2 });
    const output = new GltfOutputBlock();
    block.output.connectTo(output.input);
    const parsed = await parseGlbAsync(await new NodeAsset({ name: "instances", outputBlock: output }).executeAsync());
    expect(parsed.json.extensionsUsed).toContain("EXT_mesh_gpu_instancing");
});

it.each([2, 3, 4])("does not batch %i eligible instances with the default minimum", async (count) => {
    const document = createInstancesDocument(count);
    const scene = document.getRoot().listScenes()[0]!;
    await new NodeAsset({ name: "default-instance-minimum", outputBlock: new InstanceBlock({ input: document }) }).executeAsync();
    expect(scene.listChildren().filter((node) => node.getMesh() !== null)).toHaveLength(count);
    expect(scene.listChildren().filter((node) => node.getExtension(EXTMeshGPUInstancing.EXTENSION_NAME) !== null)).toHaveLength(0);

    await new NodeAsset({ name: "configured-instance-minimum", outputBlock: new InstanceBlock({ input: document, min: 2 }) }).executeAsync();
    const batches = scene.listChildren().filter((node) => node.getExtension(EXTMeshGPUInstancing.EXTENSION_NAME) !== null);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.getExtension<InstancedMesh>(EXTMeshGPUInstancing.EXTENSION_NAME)!.getAttribute("TRANSLATION")?.getCount()).toBe(count);
});

it("batches five eligible instances with the default minimum", async () => {
    const document = createInstancesDocument(5);
    const scene = document.getRoot().listScenes()[0]!;
    await new NodeAsset({ name: "default-instance-minimum", outputBlock: new InstanceBlock({ input: document }) }).executeAsync();
    const batches = scene.listChildren().filter((node) => node.getExtension(EXTMeshGPUInstancing.EXTENSION_NAME) !== null);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.getExtension<InstancedMesh>(EXTMeshGPUInstancing.EXTENSION_NAME)!.getAttribute("TRANSLATION")?.getCount()).toBe(5);
});

function createInstancesDocument(count: number) {
    const document = createGridDocument(1);
    const scene = document.getRoot().listScenes()[0]!;
    const mesh = document.getRoot().listMeshes()[0]!;
    scene.listChildren()[0]!.setTranslation([1, 0, 0]);
    for (let i = 1; i < count; i++) {
        scene.addChild(
            document
                .createNode()
                .setMesh(mesh)
                .setTranslation([i + 1, 0, 0])
        );
    }
    return document;
}
