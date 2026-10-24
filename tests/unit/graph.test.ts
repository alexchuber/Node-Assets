import { Document } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

import { DedupBlock, GltfInputBlock, GltfOutputBlock, GraphError, NodeAsset, NodeAssetContext, parseGraph, serializeGraph } from "../../packages/core/src/index";
import { Block } from "../../packages/core/src/blocks/block";
import { defineBlock } from "../../packages/core/src/blocks/blockDefinition";
import { GltfDocumentType } from "../../packages/core/src/connectionPoints/gltfDocument";

describe("graph serialization", () => {
    it("round trips config, implicit connections, and defaults", () => {
        const value = {
            graph: 1,
            blocks: [
                { type: "transform.resize-textures", config: { maxSize: 512 } },
                { type: "transform.encode-textures", config: { quality: 90, slots: "color" } },
            ],
        };
        const graph = parseGraph(value);
        expect(graph.head).toBe(graph.blocks[0]);
        expect(graph.tail).toBe(graph.blocks[1]);
        expect(graph.tail.input._source).toBe(graph.head.output);
        expect(serializeGraph(graph.blocks)).toEqual(value);
        const defaults = serializeGraph(graph.blocks, { defaults: true });
        expect(defaults.blocks[0]?.config).toEqual({ maxSize: 512, slots: "all" });
        expect(defaults.blocks[1]?.config).toEqual({ format: "webp", quality: 90, slots: "color" });
        expect(serializeGraph(parseGraph(defaults).blocks, { defaults: true })).toEqual(defaults);
    });

    it("accepts explicit earlier IDs and block version 1", () => {
        const graph = parseGraph({
            graph: 1,
            blocks: [
                { type: "transform.dedup", id: "first", version: 1 },
                { type: "transform.weld", input: "first" },
            ],
        });
        expect(graph.tail.input._source).toBe(graph.head.output);
        expect(serializeGraph(graph.blocks)).toEqual({ graph: 1, blocks: [{ type: "transform.dedup" }, { type: "transform.weld" }] });
    });

    it("executes a parsed graph using a contextual Document", async () => {
        const graph = parseGraph({ graph: 1, blocks: [{ type: "transform.dedup" }] });
        const output = new GltfOutputBlock();
        graph.tail.output.connectTo(output.input);
        const asset = new NodeAsset({ name: "parsed-document", outputBlock: output });
        const context = new NodeAssetContext(asset);
        context.setInput(graph.head, new Document());
        expect(await asset.executeAsync(context)).toBeInstanceOf(File);
    });

    it("omits external input and output blocks when serializing transforms", () => {
        const input = new GltfInputBlock();
        const transform = new DedupBlock();
        const output = new GltfOutputBlock();
        input.output.connectTo(transform.input);
        transform.output.connectTo(output.input);
        expect(serializeGraph([transform])).toEqual({ graph: 1, blocks: [{ type: "transform.dedup" }] });
    });

    it("can express the CLI optimize graph", () => {
        const blocks = [
            { type: "transform.metal-rough" },
            { type: "transform.dedup" },
            { type: "transform.cull-unused" },
            { type: "transform.weld" },
            { type: "transform.resize-textures", config: { maxSize: 2048 } },
            { type: "transform.encode-textures", config: { format: "webp", quality: 90, slots: "color" } },
            { type: "transform.encode-textures", config: { format: "webp", quality: 95, slots: "data" } },
            { type: "transform.quantize" },
            { type: "transform.cull-unused" },
        ];
        const graph = parseGraph({ graph: 1, blocks });
        expect(graph.blocks).toHaveLength(9);
        expect(parseGraph(serializeGraph(graph.blocks)).blocks).toHaveLength(9);
    });

    it.each([
        null,
        [],
        new Date(),
        { graph: 2, blocks: [] },
        { graph: 1, blocks: [], name: "not-core" },
        { graph: 1, blocks: {} },
        { graph: 1, blocks: [] },
        { graph: 1, blocks: [null] },
        { graph: 1, blocks: [{ type: 1 }] },
        { graph: 1, blocks: [{ type: "transform.unknown" }] },
        { graph: 1, blocks: [{ type: "input.gltf" }] },
        { graph: 1, blocks: [{ type: "output.gltf" }] },
        { graph: 1, blocks: [{ type: "transform.dedup", unexpected: true }] },
        { graph: 1, blocks: [{ type: "transform.dedup", auxiliaryInputs: {} }] },
        { graph: 1, blocks: [{ type: "transform.dedup", config: { [Symbol("unknown")]: true } }] },
        { graph: 1, blocks: [{ type: "transform.dedup" }], [Symbol("unknown")]: true },
        { graph: 1, blocks: [{ type: "transform.dedup", version: 2 }] },
        { graph: 1, blocks: [{ type: "transform.dedup", config: null }] },
        { graph: 1, blocks: [{ type: "transform.dedup", config: { unexpected: true } }] },
        { graph: 1, blocks: [{ type: "transform.resize-textures", config: { maxSize: 0 } }] },
        { graph: 1, blocks: [{ type: "transform.resize-textures", config: { maxSize: 1.5 } }] },
        { graph: 1, blocks: [{ type: "transform.encode-textures", config: { slots: "mixed" } }] },
        { graph: 1, blocks: [{ type: "transform.simplify", config: { lockBorder: "true" } }] },
        { graph: 1, blocks: [{ type: "transform.simplify", config: { error: Infinity } }] },
        { graph: 1, blocks: [{ type: "transform.dedup", id: "" }] },
        { graph: 1, blocks: [{ type: "transform.dedup", id: 1 }] },
        { graph: 1, blocks: [{ type: "transform.dedup", input: 1 }] },
        { graph: 1, blocks: [{ type: "transform.dedup", input: "missing" }] },
        {
            graph: 1,
            blocks: [
                { type: "transform.dedup", input: "later" },
                { type: "transform.weld", id: "later" },
            ],
        },
        {
            graph: 1,
            blocks: [
                { type: "transform.dedup", id: "same" },
                { type: "transform.weld", id: "same" },
            ],
        },
        { graph: 1, blocks: [{ type: "transform.dedup", id: "a" }, { type: "transform.weld" }, { type: "transform.quantize", input: "a" }] },
    ])("rejects invalid input %# with GraphError", (value) => {
        expect(() => parseGraph(value)).toThrow(GraphError);
    });

    it("locates invalid config values and supplies descriptor hints", () => {
        try {
            parseGraph({ graph: 1, blocks: [{ type: "transform.encode-textures", config: { quality: 101 } }] });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(GraphError);
            expect((error as GraphError).path).toBe("blocks[0].config.quality");
            expect((error as GraphError).hint).toBeTypeOf("string");
        }
    });

    it("round trips every registered transform with its defaults", () => {
        const types = [
            "cull-unused",
            "dedup",
            "encode-draco",
            "encode-ktx2",
            "encode-meshopt",
            "encode-textures",
            "flatten",
            "instance",
            "metal-rough",
            "quantize",
            "resize-textures",
            "simplify",
            "strip-materials",
            "validate",
            "weld",
        ].map((name) => `transform.${name}`);
        const graph = parseGraph({ graph: 1, blocks: types.map((type) => ({ type })) });
        expect(serializeGraph(graph.blocks).blocks).toEqual(types.map((type) => ({ type })));
        const defaults = serializeGraph(graph.blocks, { defaults: true });
        expect(serializeGraph(parseGraph(defaults).blocks, { defaults: true })).toEqual(defaults);
    });

    it("rejects unsupported auxiliary inputs and invalid serialization topology", () => {
        const auxiliary = new Block(
            defineBlock({
                type: "transform.dedup",
                input: GltfDocumentType,
                output: GltfDocumentType,
                auxiliaryInputs: { other: GltfDocumentType },
                run: (document) => document,
            })
        );
        expect(() => serializeGraph([auxiliary])).toThrow(GraphError);
        expect(() => serializeGraph([])).toThrow(GraphError);
        expect(() => serializeGraph([new GltfInputBlock()])).toThrow(GraphError);
        expect(() => serializeGraph([new DedupBlock(), new DedupBlock()])).toThrow(GraphError);
        const graph = parseGraph({ graph: 1, blocks: [{ type: "transform.dedup" }, { type: "transform.weld" }] });
        expect(() => serializeGraph([...graph.blocks].reverse())).toThrow(GraphError);
        expect(() => serializeGraph([graph.head, graph.head])).toThrow(GraphError);
    });
});
