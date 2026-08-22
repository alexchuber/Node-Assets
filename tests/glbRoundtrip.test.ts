import { describe, expect, it } from "vitest";

import { InputBlock, NodeAsset, OutputBlock, ParseGLBBlock, SerializeGLBBlock } from "../src/index";
import { createGlbFixtureAsync, readGlbStructureAsync } from "./glbFixture";

describe("GLB roundtrip", () => {
    it("roundtrips an in-memory GLB through the public block chain", async () => {
        const fixture = await createGlbFixtureAsync();
        const result = await buildRoundtripAsync(fixture.bytes);

        expect(new TextDecoder().decode(result.subarray(0, 4))).toBe("glTF");
        expect(new DataView(result.buffer, result.byteOffset, result.byteLength).getUint32(4, true)).toBe(2);
        expect(await readGlbStructureAsync(result)).toEqual(fixture.structure);
    });

    it("emits a GLB with a valid header and JSON/BIN chunk layout", async () => {
        const fixture = await createGlbFixtureAsync();
        const result = await buildRoundtripAsync(fixture.bytes);
        const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
        const jsonChunkLength = view.getUint32(12, true);
        const jsonChunkType = view.getUint32(16, true);
        const binChunkOffset = 20 + jsonChunkLength;
        const binChunkLength = view.getUint32(binChunkOffset, true);
        const binChunkType = view.getUint32(binChunkOffset + 4, true);

        expect(result.byteLength % 4).toBe(0);
        expect(view.getUint32(8, true)).toBe(result.byteLength);
        expect(jsonChunkLength % 4).toBe(0);
        expect(jsonChunkType).toBe(0x4e4f534a);
        expect(binChunkLength % 4).toBe(0);
        expect(binChunkType).toBe(0x004e4942);
        expect(binChunkOffset + 8 + binChunkLength).toBe(result.byteLength);
    });

    it("supports repeated builds with fresh headless scenes and engines", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");

        input.source = fixture.bytes;
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        try {
            await asset.buildAsync();
            const firstResult = output.data;
            await asset.buildAsync();
            const secondResult = output.data;

            expect(secondResult).not.toBe(firstResult);
            expect(await readGlbStructureAsync(firstResult)).toEqual(fixture.structure);
            expect(await readGlbStructureAsync(secondResult)).toEqual(fixture.structure);
        } finally {
            asset.dispose();
        }
    });

    it("normalizes an in-memory byte view as GLB input", async () => {
        const fixture = await createGlbFixtureAsync();
        const padded = new Uint8Array(fixture.bytes.length + 8);
        padded.set(fixture.bytes, 4);

        const result = await buildRoundtripAsync(new DataView(padded.buffer, 4, fixture.bytes.length));
        const arrayBufferResult = await buildRoundtripAsync(fixture.bytes.slice().buffer);

        expect(await readGlbStructureAsync(result)).toEqual(fixture.structure);
        expect(await readGlbStructureAsync(arrayBufferResult)).toEqual(fixture.structure);
    });

    it("includes the parse block name when loading fails", async () => {
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");

        input.source = new Uint8Array([0, 1, 2, 3]);
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        await expect(asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed');
        expect(() => output.data).toThrow('Output block "destination"');

        asset.dispose();
    });

    it("clears failed GLB output and permits a later rebuild", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");

        input.source = fixture.bytes;
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        try {
            await asset.buildAsync();
            input.source = new Uint8Array([0, 1, 2, 3]);
            await expect(asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed');
            expect(() => output.data).toThrow('Output block "destination"');

            input.source = fixture.bytes;
            await asset.buildAsync();
            expect(await readGlbStructureAsync(output.data)).toEqual(fixture.structure);
        } finally {
            asset.dispose();
        }
    });
});

async function buildRoundtripAsync(source: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<Uint8Array> {
    const input = new InputBlock("source");
    const parse = new ParseGLBBlock("parse");
    const serialize = new SerializeGLBBlock("serialize");
    const output = new OutputBlock("destination");
    const asset = new NodeAsset("graph");

    input.source = source;
    input.output.connectTo(parse.input);
    parse.output.connectTo(serialize.input);
    serialize.output.connectTo(output.input);
    asset.addOutputBlock(output);

    try {
        await asset.buildAsync();
        return output.data;
    } finally {
        asset.dispose();
    }
}
