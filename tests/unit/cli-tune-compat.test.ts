import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { EXTTextureAVIF, EXTTextureWebP } from "@gltf-transform/extensions";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDoc, writeGlb } from "../../packages/cli/src/document";
import { executeGraph } from "../../packages/cli/src/execution";
import { instantiateGraph, normalizeGraph, readGraph, writeGraph } from "../../packages/cli/src/graphFiles";
import { inputHash } from "../../packages/cli/src/inputs";
import { extensionsOf } from "../../packages/cli/src/measure";
import { CliError } from "../../packages/cli/src/output";
import type { FidelityRenderer } from "../../packages/cli/src/render";
import { createTuneExecutor } from "../../packages/cli/src/tune/cache";
import { tune } from "../../packages/cli/src/tune/search";
import { compileStages } from "../../packages/cli/src/tune/stages";
import { createGridDocument, createRasterImageAsync } from "../helpers/document";

async function texturedSource(format: "webp" | "avif" | "ktx2", mixed = false): Promise<Uint8Array> {
    const doc = createGridDocument(1);
    const texture = doc
        .createTexture()
        .setURI(`albedo.${format}`)
        .setMimeType(`image/${format === "ktx2" ? "png" : format}`)
        .setImage(await createRasterImageAsync(format === "ktx2" ? "png" : format));
    const material = doc.createMaterial().setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
    if (mixed) material.setOcclusionTexture(texture);
    doc.getRoot()
        .listMeshes()[0]!
        .listPrimitives()[0]!
        .setMaterial(material)
        .setAttribute(
            "TEXCOORD_0",
            doc
                .createAccessor()
                .setType("VEC2")
                .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]))
                .setBuffer(doc.getRoot().listBuffers()[0]!)
        );
    if (format === "ktx2") return executeGraph(instantiateGraph({ graph: 1, blocks: [{ type: "transform.encode-ktx2", config: { mode: "etc1s" } }] }), doc);
    if (format === "webp") doc.createExtension(EXTTextureWebP).setRequired(true);
    else doc.createExtension(EXTTextureAVIF).setRequired(true);
    return writeGlb(doc);
}

function renderer(pngFidelity = 1): FidelityRenderer {
    return {
        browserName: "test",
        start: async () => {},
        stop: async () => {},
        setReference: async () => ({ frame: { c: [0, 0, 0], r: 1 }, loadMs: 0 }),
        evaluate: async (bytes) => ({
            worst: (await readDoc(bytes)).getRoot().listTextures()[0]!.getMimeType() === "image/png" ? pngFidelity : 1,
            worstView: 0,
            loadMs: 0,
        }),
        preview: async () => Buffer.alloc(0),
    };
}

describe("compat's mandatory texture fallback", () => {
    let directory: string;
    beforeAll(async () => {
        directory = resolve(`_tune-compat-${randomUUID()}`);
        await mkdir(directory);
    });
    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it.each(["webp", "avif", "ktx2"] as const)(
        "converts %s to original-size PNG after expiry and matches the saved graph",
        async (format) => {
            const source = await texturedSource(format);
            const input = join(directory, `${format}.glb`);
            await writeFile(input, source);
            const executor = createTuneExecutor();
            try {
                const result = await tune(source, await inputHash(input), {
                    goals: ["compat"],
                    floor: 0.9,
                    view: 64,
                    network: "4g",
                    amortize: 1,
                    deadline: 0,
                    keep: new Set(),
                    renderer: renderer(),
                    executor,
                });
                const winner = result.winners.compat!;
                expect(result.stoppedEarly).toBe(true);
                expect(winner.stages.textures).toMatchObject({ format: "png", maxSize: 32 });
                expect(winner.required).toEqual([]);
                expect(winner.decoders).toEqual([]);
                const texture = (await readDoc(winner.glb)).getRoot().listTextures()[0]!;
                expect(texture.getMimeType()).toBe("image/png");
                expect(texture.getSize()).toEqual([32, 16]);
                if (format !== "ktx2") {
                    const original = (await readDoc(source)).getRoot().listTextures()[0]!;
                    expect(await sharp(texture.getImage()!).ensureAlpha().raw().toBuffer()).toEqual(await sharp(original.getImage()!).ensureAlpha().raw().toBuffer());
                }
                const graph = join(directory, `${format}.compat.toon`);
                await writeGraph(graph, normalizeGraph({ ...compileStages(winner.stages, 32), goal: "compat" }));
                const applied = await executeGraph(instantiateGraph(await readGraph(graph)), input);
                expect(extensionsOf(await readDoc(applied)).required).toEqual([]);
                expect(applied).toEqual(winner.glb);
            } finally {
                executor.clear();
            }
        },
        30_000
    );

    it.each([
        [0.8, false],
        [1, true],
    ] as const)("rejects a fallback that fails fidelity or eligibility %#", async (fidelity, mixed) => {
        const executor = createTuneExecutor();
        try {
            await expect(
                tune(await texturedSource("webp", mixed), `rejected-${mixed}`, {
                    goals: ["compat"],
                    floor: 0.9,
                    view: 64,
                    network: "4g",
                    amortize: 1,
                    deadline: 0,
                    keep: new Set(),
                    renderer: renderer(fidelity),
                    executor,
                })
            ).rejects.toBeInstanceOf(CliError);
        } finally {
            executor.clear();
        }
    });
});
