import { NodeIO } from "@gltf-transform/core";
import { expect, it } from "vitest";

import { DequantizeBlock, GltfOutputBlock, NodeAsset, QuantizeBlock } from "../../packages/core/src/index";
import { createGridDocument } from "../helpers/document";

it("writes unquantized float attributes without KHR_mesh_quantization", async () => {
    const quantized = await new NodeAsset({ name: "quantize", outputBlock: new QuantizeBlock({ input: createGridDocument(2) }) }).executeAsync();
    const sourcePosition = quantized.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute("POSITION")!;
    expect(sourcePosition.getArray()).toBeInstanceOf(Int16Array);
    expect(sourcePosition.getNormalized()).toBe(true);
    expect(
        quantized
            .getRoot()
            .listExtensionsRequired()
            .map((extension) => extension.extensionName)
    ).toContain("KHR_mesh_quantization");

    const block = new DequantizeBlock({ input: quantized });
    const output = new GltfOutputBlock();
    block.output.connectTo(output.input);
    const asset = new NodeAsset({ name: "dequantize", outputBlock: output });
    try {
        const glb = await asset.executeAsync();
        const doc = await new NodeIO().readBinary(new Uint8Array(await glb.arrayBuffer()));
        const primitive = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
        for (const semantic of ["POSITION", "NORMAL"]) {
            expect(primitive.getAttribute(semantic)!.getArray()).toBeInstanceOf(Float32Array);
            expect(primitive.getAttribute(semantic)!.getNormalized()).toBe(false);
        }
        expect(doc.getRoot().listExtensionsRequired()).toEqual([]);
        expect(doc.getRoot().listExtensionsUsed()).toEqual([]);
    } finally {
        asset.dispose();
    }
});
