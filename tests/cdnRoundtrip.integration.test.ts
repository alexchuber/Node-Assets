import { describe, expect, it } from "vitest";

import { InputBlock, NodeAsset, OutputBlock, ParseGLBBlock, SerializeGLBBlock } from "../src/index";
import { readGlbStructureAsync } from "./glbFixture";

describe("CDN GLB roundtrip", () => {
    it("roundtrips the hello-world CDN GLB through the full public graph", async () => {
        const input = new InputBlock("source");
        input.source = "https://assets.babylonjs.com/meshes/seagulf.glb";

        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("optimized.glb");

        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);

        const asset = new NodeAsset("myGraph");
        asset.addOutputBlock(output);

        try {
            await asset.buildAsync();
            const glb: Uint8Array = output.data;

            expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe("glTF");
            expect(new DataView(glb.buffer, glb.byteOffset, glb.byteLength).getUint32(4, true)).toBe(2);

            const structure = await readGlbStructureAsync(glb);
            expect(structure.meshes.length).toBeGreaterThan(0);
            expect(structure.meshes.every(({ name, vertexCount, indexCount }) => name.length > 0 && vertexCount > 0 && indexCount > 0)).toBe(true);
            expect(structure.materials.length).toBeGreaterThan(0);
            expect(structure.materials.every(({ name, type }) => name.length > 0 && type.length > 0)).toBe(true);
        } finally {
            asset.dispose();
        }
    }, 30_000);
});
