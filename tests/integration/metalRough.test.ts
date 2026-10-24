import { Document } from "@gltf-transform/core";
import { KHRMaterialsPBRSpecularGlossiness } from "@gltf-transform/extensions";
import { expect, it } from "vitest";

import { GltfOutputBlock, MetalRoughBlock, NodeAsset } from "../../packages/core/src/index";
import { createGridDocument } from "../helpers/document";
import { parseGlbAsync } from "../helpers/glb";

it("converts specular/glossiness materials and leaves other documents unchanged", async () => {
    const document = createGridDocument(1);
    const extension = document.createExtension(KHRMaterialsPBRSpecularGlossiness);
    const material = document.createMaterial().setExtension(extension.extensionName, extension.createPBRSpecularGlossiness().setDiffuseFactor([0.5, 0.2, 0.1, 1]));
    document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(material);
    const block = new MetalRoughBlock({ input: document });
    const output = new GltfOutputBlock();
    block.output.connectTo(output.input);
    const parsed = await parseGlbAsync(await new NodeAsset({ name: "metal-rough", outputBlock: output }).executeAsync());
    expect(document.hasExtension(extension.extensionName)).toBe(false);
    expect(material.getBaseColorFactor()).not.toEqual([1, 1, 1, 1]);
    expect(parsed.json.extensionsUsed).toContain("KHR_materials_ior");
    expect(parsed.json.extensionsUsed).toContain("KHR_materials_specular");

    const plain = new Document();
    const original = plain.createMaterial().setRoughnessFactor(0.3);
    expect(await new NodeAsset({ name: "already-metal-rough", outputBlock: new MetalRoughBlock({ input: plain }) }).executeAsync()).toBe(plain);
    expect(original.getRoughnessFactor()).toBe(0.3);
});
