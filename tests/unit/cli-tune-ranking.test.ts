import { describe, expect, it } from "vitest";

import { writeGlb } from "../../packages/cli/src/document";
import type { FidelityRenderer } from "../../packages/cli/src/render";
import { tune } from "../../packages/cli/src/tune";
import { createGridDocument } from "../helpers/document";

describe("tune fidelity tie-breaking", () => {
    it("groups three-decimal scores into hundredths before preferring smaller files", async () => {
        const doc = createGridDocument(1);
        const candidates: Uint8Array[] = [];
        for (const length of [1000, 1004, 1008]) {
            doc.getRoot().setExtras({ padding: "x".repeat(length) });
            candidates.push(await writeGlb(doc));
        }
        const [baseline, draco, meshopt] = candidates as [Uint8Array, Uint8Array, Uint8Array];
        expect(meshopt.length).toBeLessThanOrEqual(baseline.length * 1.01);
        const fidelity = new Map([
            [baseline, 0.934],
            [draco, 0.935],
            [meshopt, 0.936],
        ]);
        const renderer: FidelityRenderer = {
            browserName: "test",
            start: async () => {},
            stop: async () => {},
            setReference: async () => ({ frame: { c: [0, 0, 0], r: 1 }, loadMs: 0 }),
            evaluate: async (bytes) => ({ worst: fidelity.get(bytes)!, worstView: 0, loadMs: 0 }),
            preview: async () => Buffer.alloc(0),
        };
        const result = await tune(baseline, "ranking", {
            goals: ["size"],
            floor: 0.9,
            view: 64,
            network: "4g",
            amortize: 1,
            deadline: Infinity,
            keep: new Set(),
            renderer,
            executor: {
                clear: () => {},
                execute: async (_hash, _input, stages) =>
                    stages.geometry.mode === "meshopt" ? meshopt : stages.geometry.mode === "draco" && stages.geometry.dracoPosition === 14 ? draco : baseline,
            },
        });
        expect(result.winners.size).toMatchObject({ fidelity: 0.935, bytes: draco.length, pass: true });
    });
});
