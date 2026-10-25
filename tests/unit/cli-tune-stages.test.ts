import { parseGraph } from "@babylonjs/node-assets";
import { describe, expect, it } from "vitest";

import { compileStages, initialStages, withStages, type TuneStages } from "../../packages/cli/src/tuneStages";

describe("tune stage compilation", () => {
    it("compiles lossless cleanup and baseline geometry into a reusable graph", () => {
        const graph = compileStages(initialStages({ maxTexture: 2048, animations: 0 }, new Set(), false), 2048);
        expect(graph).toEqual({
            graph: 1,
            blocks: [
                { type: "transform.metal-rough" },
                { type: "transform.dedup" },
                { type: "transform.cull-unused" },
                { type: "transform.weld" },
                { type: "transform.flatten" },
                { type: "transform.instance", config: { min: 2 } },
                { type: "transform.quantize" },
                { type: "transform.cull-unused" },
            ],
        });
        expect(parseGraph(graph).blocks).toHaveLength(8);
    });

    it.each(["keep", "webp", "avif", "jpeg", "png"] as const)("compiles %s texture settings with separate color and data qualities", (format) => {
        const stages = withStages(initialStages({ maxTexture: 2048, animations: 0 }, new Set(), false), {
            textures: { format, maxSize: 1024, quality: 60, dataQuality: 80 },
        });
        const graph = compileStages(stages, 2048);
        const textures = graph.blocks.filter((block) => /textures$/.test(block.type));
        expect(textures).toEqual([
            { type: "transform.resize-textures", config: { maxSize: 1024, slots: "all" } },
            ...(format === "keep"
                ? []
                : [
                      { type: "transform.encode-textures", config: { format, quality: format === "avif" ? 42 : 60, slots: "color" } },
                      { type: "transform.encode-textures", config: { format, quality: format === "avif" ? 56 : 80, slots: "data" } },
                  ]),
        ]);
        expect(parseGraph(graph).blocks).toHaveLength(graph.blocks.length);
    });

    it.each([
        ["etc1s", "uastc", "auto"],
        ["uastc", "uastc", "uastc"],
        ["etc1s", "etc1s", "etc1s"],
    ] as const)("compiles KTX2 %s/%s as %s", (color, data, mode) => {
        const stages = withStages(initialStages({ maxTexture: 1024, animations: 0 }, new Set(), false), {
            textures: { format: "ktx2", maxSize: 512, ktx2: { color, data } },
        });
        const graph = compileStages(stages, 1024);
        expect(graph.blocks).toContainEqual({ type: "transform.resize-textures", config: { maxSize: 512, slots: "all" } });
        expect(graph.blocks).toContainEqual({
            type: "transform.encode-ktx2",
            config: { mode, slots: "all", etc1sQuality: 128, uastcQuality: 1, zstd: true },
        });
        expect(parseGraph(graph).blocks).toHaveLength(graph.blocks.length);
    });

    it.each(["keep", "webp", "avif", "jpeg", "png", "ktx2"] as const)("omits resizing %s when the target is no smaller than the original", (format) => {
        const graph = compileStages(withStages(initialStages({ maxTexture: 512, animations: 0 }, new Set(), false), { textures: { format, maxSize: 1024 } }), 512);
        expect(graph.blocks.some((block) => block.type === "transform.resize-textures")).toBe(false);
        expect(parseGraph(graph).blocks).toHaveLength(graph.blocks.length);
    });

    it.each([
        [{ mode: "none" }, { type: "transform.dequantize" }],
        [{ mode: "quantize" }, { type: "transform.quantize" }],
        [
            { mode: "meshopt", meshoptLevel: "medium" },
            { type: "transform.encode-meshopt", config: { level: "medium" } },
        ],
        [
            { mode: "meshopt", meshoptLevel: "high" },
            { type: "transform.encode-meshopt", config: { level: "high" } },
        ],
        [
            { mode: "draco", dracoPosition: 14, dracoNormal: 10, dracoTexcoord: 12 },
            { type: "transform.encode-draco", config: { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, decodeSpeed: 5, encodeSpeed: 5, method: "edgebreaker" } },
        ],
        [
            { mode: "draco", dracoPosition: 11, dracoNormal: 8, dracoTexcoord: 10 },
            { type: "transform.encode-draco", config: { quantizePosition: 11, quantizeNormal: 8, quantizeTexcoord: 10, decodeSpeed: 5, encodeSpeed: 5, method: "edgebreaker" } },
        ],
    ] as const)("compiles geometry %#", (geometry, expected) => {
        const stages = withStages(initialStages({ maxTexture: 0, animations: 0 }, new Set(), false), { geometry: geometry as Partial<TuneStages["geometry"]> });
        const graph = compileStages(stages, 0);
        expect(graph.blocks.slice(-2)).toEqual([expected, { type: "transform.cull-unused" }]);
        expect(parseGraph(graph).blocks).toHaveLength(graph.blocks.length);
    });

    it("compiles simplify before encoding, with the search error bound", () => {
        const stages = withStages(initialStages({ maxTexture: 0, animations: 0 }, new Set(), false), { geometry: { mode: "none", simplify: 0.5 } });
        const graph = compileStages(stages, 0);
        expect(graph.blocks.slice(-3)).toEqual([
            { type: "transform.simplify", config: { ratio: 0.5, error: 0.002 } },
            { type: "transform.dequantize" },
            { type: "transform.cull-unused" },
        ]);
        expect(parseGraph(graph).blocks).toHaveLength(graph.blocks.length);
    });

    it("keeps hierarchy and original texture dimensions when requested, and keeps geometry unsimplified", () => {
        const stages = initialStages({ maxTexture: 2048, animations: 0 }, new Set(["hierarchy", "texture-size", "geometry"]), false);
        const graph = compileStages(stages, 2048);
        expect(graph.blocks.map((block) => block.type)).toEqual([
            "transform.metal-rough",
            "transform.dedup",
            "transform.cull-unused",
            "transform.weld",
            "transform.quantize",
            "transform.cull-unused",
        ]);
        expect(parseGraph(graph).blocks).toHaveLength(6);
    });

    it("does not flatten animated models, and uses no instancing or geometry codec for compat", () => {
        const graph = compileStages(initialStages({ maxTexture: 0, animations: 1 }, new Set(), true), 0);
        expect(graph.blocks.map((block) => block.type)).toEqual([
            "transform.metal-rough",
            "transform.dedup",
            "transform.cull-unused",
            "transform.weld",
            "transform.dequantize",
            "transform.cull-unused",
        ]);
        expect(parseGraph(graph).blocks).toHaveLength(6);
    });
});
