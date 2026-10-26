import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { graphHash, normalizeGraph, parseGraphFile, readGraphAsync, serializeGraphFile } from "../../packages/cli/src/graphFiles";

describe("CLI graph files", () => {
    it("fills defaults and round trips metadata", () => {
        const value = normalizeGraph({
            graph: 1,
            name: "example.size",
            goal: "size",
            blocks: [{ type: "transform.encode-textures" }],
            check: { fidelity: 0.9, view: 64 },
            tuned: { input: "model.glb", renderer: "Chrome" },
        });
        expect(value.blocks[0]?.config).toEqual({ format: "webp", quality: 80, slots: "all" });
        const text = serializeGraphFile(value);
        expect(text.match(/^(?:graph|name|goal|blocks|check|tuned)\b/gm)).toEqual(["graph", "name", "goal", "blocks", "check", "tuned"]);
        expect(parseGraphFile(text)).toEqual(value);
    });

    it("hashes canonical defaults, not metadata or config key order", () => {
        const a = normalizeGraph({ graph: 1, blocks: [{ type: "transform.encode-textures" }] });
        const b = normalizeGraph({ graph: 1, name: "other", blocks: [{ type: "transform.encode-textures", config: { slots: "all", quality: 80, format: "webp" } }] });
        expect(graphHash(a)).toBe(graphHash(b));
        expect(graphHash(a)).toMatch(/^[0-9a-f]{12}$/);
        const c = normalizeGraph({ graph: 1, blocks: [{ type: "transform.encode-textures", config: { quality: 40 } }] });
        expect(graphHash(a)).not.toBe(graphHash(c));
    });

    it.each([
        null,
        { graph: 2, blocks: [] },
        { graph: 1, blocks: [{ type: "transform.missing" }] },
        { graph: 1, blocks: [{ type: "transform.encode-textures", config: { quality: 0 } }] },
        { graph: 1, blocks: [{ type: "transform.dedup" }], extra: true },
        { graph: 1, blocks: [{ type: "transform.dedup" }], check: { fidelity: 2 } },
        { graph: 1, blocks: [{ type: "transform.dedup" }], check: { view: 0 } },
        { graph: 1, blocks: [{ type: "transform.dedup" }], check: { fidelity: null } },
        { graph: 1, blocks: [{ type: "transform.dedup" }], check: { view: null } },
        { graph: 1, blocks: [{ type: "transform.dedup" }], check: { typo: 1 } },
    ])("rejects invalid graph %#", (value) => {
        expect(() => normalizeGraph(value)).toThrow();
    });

    it("rejects malformed TOON", () => {
        expect(() => parseGraphFile("graph: 1\nblocks[2]:\n  - type: transform.dedup\n")).toThrow();
    });

    it("resolves bare built-ins but treats extension arguments as files", async () => {
        const builtin = await readGraphAsync("optimize");
        const text = await readFile(new URL("../../packages/cli/graphs/optimize.toon", import.meta.url), "utf8");
        expect(builtin).toEqual(parseGraphFile(text));
        await expect(readGraphAsync("optimize.toon")).rejects.toThrow();
        await expect(readGraphAsync("unknown")).rejects.toThrow();
    });
});
