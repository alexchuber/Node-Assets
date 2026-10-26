import { describe, expect, it, vi } from "vitest";

import { fitLoadModel, nnls } from "../../packages/cli/dev/calibrate/fit";
import { calibrationVariants, executeVariantAsync, variantGraph } from "../../packages/cli/dev/calibrate/variants";
import { readDocAsync } from "../../packages/cli/src/document";
import { executeGraphAsync } from "../../packages/cli/src/execution";
import { instantiateGraph } from "../../packages/cli/src/graphFiles";
import { COEF_SOURCE, decodeMs, features } from "../../packages/cli/src/loadModel";
import { createGridDocument } from "../helpers/document";

vi.mock("../../packages/cli/src/loadModel.coefficients.json", () => ({
    default: {
        coefficients: {
            c0: 38.28,
            draco: 39.84,
            meshopt: 0,
            ktx2: 271.48,
            draco_mb: 180.93,
            meshopt_mb: 19.58,
            plain_mb: 7.53,
            mp_avif: 9,
            mp_webp: 8.77,
            mp_jpeg: 8.41,
            mp_png: 13.27,
            mp_ktx2: 22.03,
        },
        source: "provisional (research prototype)",
        fitted: null,
    },
}));

describe("load calibration", () => {
    it("recovers known nonnegative coefficients", () => {
        const matrix = [
            [1, 0, 0],
            [1, 1, 0],
            [1, 0, 1],
            [1, 2, 3],
            [1, 4, 1],
        ];
        const expected = [12, 0, 7];
        const measured = matrix.map((row) => row.reduce((sum, value, index) => sum + value * expected[index]!, 0));
        const actual = nnls(matrix, measured);
        actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 8));
    });

    it("solves a constrained system instead of clipping an unconstrained solution", () => {
        const actual = nnls(
            [
                [1, 1],
                [1, 2],
                [1, 3],
            ],
            [3, 2, 1]
        );
        expect(actual[0]).toBeCloseTo(2, 8);
        expect(actual[1]).toBe(0);
    });

    it("handles absent, dependent, differently scaled and underdetermined features", () => {
        const matrix = [
            [1, 0, 1, 0, 1e-6],
            [1, 0, 1, 1, 2e-6],
            [1, 0, 1, 2, 4e-6],
        ];
        const measured = [4, 7, 11];
        const coefficients = nnls(matrix, measured);
        expect(coefficients.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
        expect(coefficients[1]).toBe(0);
        matrix.forEach((row, index) => {
            expect(row.reduce((sum, value, column) => sum + value * coefficients[column]!, 0)).toBeCloseTo(measured[index]!, 7);
        });
    });

    it("reports undefined validation for one model and constant measurements", () => {
        const fit = fitLoadModel([
            { input: "one.glb", ms: 10, features: {} },
            { input: "one.glb", ms: 10, features: {} },
        ]);
        expect(fit.fitted).toMatchObject({ n: 2, r2: null });
        expect(fit.fitted.maeMs).toBeCloseTo(0, 10);
        expect(fit.leaveOneModelOut).toEqual([{ input: "one.glb", n: 2, maeMs: null, rankCorrelation: null }]);
    });

    it("validates rankings on models omitted from fitting", () => {
        const rows = ["helmet.glb", "lantern.glb", "boombox.glb"].flatMap((input, model) =>
            [
                [0, 0],
                [1, 0],
                [0, 1],
                [2, 3],
            ].map(([geometry, image]) => {
                const plain_mb = geometry! * (model + 1);
                const mp_png = image! * (model + 1);
                return { input, ms: 12 + 7 * plain_mb + 3 * mp_png, features: { plain_mb, mp_png } };
            })
        );
        const result = fitLoadModel(rows);
        expect(result.coefficients.c0).toBeCloseTo(12, 8);
        expect(result.coefficients.plain_mb).toBeCloseTo(7, 8);
        expect(result.coefficients.mp_png).toBeCloseTo(3, 8);
        expect(result.fitted.r2).toBeCloseTo(1, 10);
        expect(result.leaveOneModelOut).toHaveLength(3);
        for (const held of result.leaveOneModelOut) {
            expect(held.maeMs).toBeCloseTo(0, 8);
            expect(held.rankCorrelation).toBeCloseTo(1, 10);
        }
    });

    it("keeps provisional decode estimates unchanged", () => {
        expect(COEF_SOURCE).toBe("provisional (research prototype)");
        expect(decodeMs({})).toBe(38.28);
        expect(decodeMs({ draco: 1, draco_mb: 2, mp_png: 3 })).toBeCloseTo(479.79, 10);
        expect(decodeMs({ meshopt: 1, meshopt_mb: 2, mp_webp: 3 })).toBeCloseTo(103.75, 10);
        expect(decodeMs({ ktx2: 1, mp_ktx2: 2, mp_avif: 3, mp_jpeg: 4 })).toBeCloseTo(414.46, 10);
        expect(decodeMs({ plain_mb: 2, mb: 999, unknown: 999 })).toBeCloseTo(53.34, 10);
        expect(decodeMs({ draco_mb: -100 })).toBe(0);
    });

    it("builds valid core graphs and puts every decoder in the smoke subset", () => {
        const variants = calibrationVariants();
        expect(variants).toHaveLength(16);
        expect(variants.slice(0, 3)).toEqual([
            { tex: "ktx2", size: 256, geo: "quantize" },
            { tex: "webp", size: 256, geo: "meshopt" },
            { tex: "avif", size: 1024, geo: "draco" },
        ]);
        for (const variant of variants) expect(instantiateGraph(variantGraph(variant)).blocks.length).toBeGreaterThan(0);
    });

    it.each([
        { codec: "draco", extension: "KHR_draco_mesh_compression", geo: "quantize" as const },
        { codec: "draco", extension: "KHR_draco_mesh_compression", geo: "none" as const },
        { codec: "meshopt", extension: "EXT_meshopt_compression", geo: "quantize" as const },
        { codec: "meshopt", extension: "EXT_meshopt_compression", geo: "none" as const },
    ])("does not retain source $codec compression in a $geo variant", async ({ codec, extension, geo }) => {
        const compressed = await executeGraphAsync(instantiateGraph({ graph: 1, blocks: [{ type: `transform.encode-${codec}` }] }), createGridDocument(1));
        const source = await readDocAsync(compressed);
        expect(
            source
                .getRoot()
                .listExtensionsUsed()
                .map((value) => value.extensionName)
        ).toContain(extension);
        expect(features(source, compressed.byteLength)[codec]).toBe(1);
        const output = await executeVariantAsync(compressed, { tex: "keep", size: 256, geo });
        const document = await readDocAsync(output);
        const used = document
            .getRoot()
            .listExtensionsUsed()
            .map((value) => value.extensionName);
        expect(used).not.toContain("KHR_draco_mesh_compression");
        expect(used).not.toContain("EXT_meshopt_compression");
        expect(features(document, output.byteLength)).toMatchObject({ draco: 0, meshopt: 0 });
        expect(document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getIndices()!.getCount()).toBe(6);
    });
});
