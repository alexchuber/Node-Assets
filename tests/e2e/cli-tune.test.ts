import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDoc } from "../../packages/cli/src/document";
import { readGraph } from "../../packages/cli/src/graphFiles";
import { decode } from "../../packages/cli/src/output";
import { findBrowser } from "../../packages/cli/src/render";
import { buildCliFixtureAsync, runNodeAsync } from "../helpers/cli";
import { createGridDocument } from "../helpers/document";

const browser = await findBrowser().catch(() => undefined);

describe.skipIf(!browser)("node-assets tune in a browser", () => {
    let directory: string;
    let launcher: string;
    beforeAll(async () => {
        directory = resolve(`_tune-e2e-${randomUUID()}`);
        await mkdir(directory);
        launcher = await buildCliFixtureAsync(directory, true);
    }, 120_000);
    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("writes three-decimal fidelity consistently to rows and tuned results", async () => {
        const doc = createGridDocument(1);
        doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(doc.createMaterial().setDoubleSided(true));
        const input = join(directory, "rounding.glb");
        await writeFile(input, await new NodeIO().writeBinary(doc));
        const graph = join(directory, "rounding.compat.toon");
        const result = await runNodeAsync([launcher, "tune", input, "--for", "compat", "--view", "64", "--time-limit", "0.001s", "-o", graph], directory);
        expect(result.code, result.stdout + result.stderr).toBe(0);
        const row = (decode(result.stdout) as { results: { fidelity: number }[] }).results[0]!;
        expect(row.fidelity).toBeGreaterThanOrEqual(0.9);
        expect(row.fidelity).toBe(Math.round(row.fidelity * 1000) / 1000);
        expect((await readGraph(graph)).tuned).toMatchObject({ result: { fidelity: row.fidelity } });
        expect(
            result.stderr
                .split("\n")
                .filter(Boolean)
                .every((line) => line.startsWith("tune:"))
        ).toBe(true);
    }, 60_000);

    it("writes size and compat graphs and worst-view previews, then runs the size graph", async () => {
        const doc = createGridDocument(2);
        const pixels = new Uint8Array(32 * 32 * 3);
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) pixels.set([160 + x * 2, 100 + y * 2, 60 + ((x + y) % 16)], (y * 32 + x) * 3);
        const png = await sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } })
            .png()
            .toBuffer();
        const texture = doc.createTexture().setMimeType("image/png").setImage(png);
        const material = doc.createMaterial().setBaseColorTexture(texture).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1);
        const uv: number[] = [];
        for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) uv.push(x / 2, y / 2);
        doc.getRoot()
            .listMeshes()[0]!
            .listPrimitives()[0]!
            .setMaterial(material)
            .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(doc.getRoot().listBuffers()[0]!));
        const input = join(directory, "tiny.glb");
        const source = await new NodeIO().writeBinary(doc);
        await writeFile(input, source);
        const output = join(directory, "graphs");
        const result = await runNodeAsync([launcher, "tune", input, "--for", "size,compat", "--view", "128", "--time-limit", "60s", "-o", output], directory, 150_000);
        expect(result.code, result.stdout + result.stderr).toBe(0);
        const stdout = decode(result.stdout) as { results: { goal: string; fidelity: number; graph: string; preview: string }[]; originals: unknown[] };
        expect(stdout.results).toHaveLength(2);
        expect(stdout.results.map((row) => row.goal)).toEqual(["size", "compat"]);
        expect(stdout.originals).toHaveLength(1);
        expect((await readdir(output)).sort()).toEqual(["tiny.compat.png", "tiny.compat.toon", "tiny.size.png", "tiny.size.toon"]);
        for (const row of stdout.results) {
            expect(row.fidelity).toBeGreaterThanOrEqual(0.9);
            const graph = await readGraph(join(directory, row.graph));
            expect(graph.check).toEqual({ fidelity: 0.9, view: 128 });
            expect(graph.tuned).toMatchObject({
                renderer: expect.stringContaining("SwiftShader"),
                network: "4g",
                amortized_over: 1,
                result: { fidelity: row.fidelity, bytes: expect.any(Number) },
            });
            const preview = await sharp(await readFile(join(directory, row.preview))).metadata();
            expect(preview.width).toBe(256);
            expect(preview.height).toBe(128);
        }
        const model = join(directory, "tiny.size.glb");
        const run = await runNodeAsync([launcher, "run", join(output, "tiny.size.toon"), input, "-o", model], directory);
        expect(run.code, run.stdout + run.stderr).toBe(0);
        expect((await stat(model)).size).toBeGreaterThan(0);
        expect((await readDoc(new Uint8Array(await readFile(model)))).getRoot().listTextures()).toHaveLength(1);
        expect(await readFile(input)).toEqual(Buffer.from(source));
    }, 180_000);
});
