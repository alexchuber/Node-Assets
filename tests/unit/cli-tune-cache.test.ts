import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDoc } from "../../packages/cli/src/document";
import { executeGraph } from "../../packages/cli/src/execution";
import { instantiateGraph, normalizeGraph, readGraph, writeGraph } from "../../packages/cli/src/graphFiles";
import { inputHash } from "../../packages/cli/src/inputs";
import { extensionsOf } from "../../packages/cli/src/measure";
import type { FidelityRenderer } from "../../packages/cli/src/render";
import { tune } from "../../packages/cli/src/tune";
import { createTuneExecutor } from "../../packages/cli/src/tuneCache";
import { compileStages, initialStages } from "../../packages/cli/src/tuneStages";
import { createGridDocument } from "../helpers/document";

describe("tune input normalization", () => {
    let directory: string;
    beforeAll(async () => {
        directory = resolve(`_tune-cache-${randomUUID()}`);
        await mkdir(directory);
    });
    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it.each([
        ["draco", "KHR_draco_mesh_compression"],
        ["meshopt", "EXT_meshopt_compression"],
    ])(
        "matches run of a saved compat graph for %s input",
        async (mode, extension) => {
            const source = await executeGraph(instantiateGraph({ graph: 1, blocks: [{ type: `transform.encode-${mode}` }] }), createGridDocument(2));
            expect(extensionsOf(await readDoc(source)).required).toContain(extension);
            const input = join(directory, `${mode}.glb`);
            await writeFile(input, source);
            const stages = initialStages({ maxTexture: 0, animations: 0 }, new Set(), true);
            const graph = join(directory, `${mode}.compat.toon`);
            await writeGraph(graph, normalizeGraph({ ...compileStages(stages, 0), goal: "compat" }));
            const executor = createTuneExecutor();
            try {
                const candidate = await executor.execute(await inputHash(input), source, stages, 0);
                const applied = await executeGraph(instantiateGraph(await readGraph(graph)), input);
                expect(extensionsOf(await readDoc(candidate)).decoders).toEqual([]);
                expect(extensionsOf(await readDoc(candidate))).toEqual(extensionsOf(await readDoc(applied)));
                expect(candidate).toEqual(applied);
            } finally {
                executor.clear();
            }
        },
        30_000
    );

    it("tunes already-quantized input for compat without required extensions", async () => {
        const source = await executeGraph(instantiateGraph({ graph: 1, blocks: [{ type: "transform.quantize" }] }), createGridDocument(2));
        expect(extensionsOf(await readDoc(source)).required).toContain("KHR_mesh_quantization");
        const input = join(directory, "quantized.glb");
        await writeFile(input, source);
        const renderer: FidelityRenderer = {
            browserName: "test",
            start: async () => {},
            stop: async () => {},
            setReference: async () => ({ frame: { c: [0, 0, 0], r: 1 }, loadMs: 0 }),
            evaluate: async () => ({ worst: 1, worstView: 0, loadMs: 0 }),
            preview: async () => Buffer.alloc(0),
        };
        const executor = createTuneExecutor();
        try {
            const searched = await tune(source, await inputHash(input), {
                goals: ["compat"],
                floor: 0.9,
                view: 128,
                network: "4g",
                amortize: 1,
                deadline: 0,
                keep: new Set(),
                renderer,
                executor,
            });
            expect(searched.stoppedEarly).toBe(true);
            const winner = searched.winners.compat!;
            const graph = join(directory, "quantized.compat.toon");
            await writeGraph(graph, normalizeGraph({ ...compileStages(winner.stages, 0), goal: "compat" }));
            expect((await readGraph(graph)).blocks).toContainEqual({ type: "transform.dequantize" });
            expect(winner.required).toEqual([]);
            const applied = await executeGraph(instantiateGraph(await readGraph(graph)), input);
            expect(extensionsOf(await readDoc(applied)).required).toEqual([]);
            expect(applied).toEqual(winner.glb);
        } finally {
            executor.clear();
        }
    });
});
