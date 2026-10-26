import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import sharp from "sharp";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRenderer, findBrowserAsync } from "../../packages/cli/src/render/index";
import { EncodeDracoBlock, EncodeKTX2Block, EncodeMeshoptBlock, GltfOutputBlock, NodeAsset } from "../../packages/core/src/index";
import { parseGlbAsync } from "../helpers/glb";

const browser = await findBrowserAsync().catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "NO_BROWSER") return undefined;
    throw error;
});
if (!browser) console.warn("Skipping offline fidelity renderer tests: no browser found; run npx playwright install chromium.");

describe.skipIf(!browser)("offline fidelity renderer", () => {
    const requests: string[] = [];
    const renderer = createRenderer({ onRequest: (url) => requests.push(url) });
    let reference: Uint8Array;
    let source: Document;
    const scores: Record<string, number> = {};

    beforeAll(async () => {
        await build({ configFile: fileURLToPath(new URL("../../packages/cli/vite.render.config.ts", import.meta.url)), logLevel: "error" });
        source = await texturedModel();
        reference = await write(source);
        await renderer.startAsync();
        console.info("Renderer:", renderer.browserName);
        await renderer.setReferenceAsync(reference, { size: 256, views: 2 });
    }, 60_000);

    afterAll(async () => {
        await renderer.stopAsync();
        console.info("Renderer scores:", scores);
    });

    it("ships licenses and notices for the bundled browser packages", async () => {
        const require = createRequire(import.meta.url);
        const renderRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/cli/dist/render");
        for (const [packageName, names] of [
            ["@babylonjs/core", ["license.md", "NOTICE.md"]],
            ["@babylonjs/loaders", ["license.md"]],
            ["@babylonjs/ktx2decoder", ["license.md", "NOTICE.md"]],
        ] as const) {
            const sourceRoot = dirname(require.resolve(`${packageName}/package.json`, { paths: [resolve(renderRoot, "../..")] }));
            for (const name of names) {
                expect(await readFile(resolve(renderRoot, "licenses", packageName, name), "utf8")).toBe(await readFile(resolve(sourceRoot, name), "utf8"));
            }
        }
    });

    it("scores an identical model and creates a side-by-side PNG", async () => {
        scores.identical = (await renderer.evaluateAsync(reference)).worst;
        expect(scores.identical).toBeGreaterThanOrEqual(0.999);
        expect(renderer.browserName).toMatch(/SwiftShader/);
        const png = await renderer.previewAsync(0);
        const metadata = await sharp(png).metadata();
        expect(metadata).toMatchObject({ format: "png", width: 512, height: 256 });
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
        let litPixels = 0;
        for (let i = 0; i < data.length; i += info.channels) {
            if (data[i]! > data[i + 1]! + 10 && data[i + 1]! > data[i + 2]! + 10) litPixels++;
        }
        expect(litPixels).toBeGreaterThan(100);
    });

    it("detects visibly moved geometry with reference framing", async () => {
        const candidate = await copy(source);
        candidate.getRoot().listNodes()[0]!.setTranslation([0.6, 0, 0]);
        const result = await renderer.evaluateAsync(await write(candidate));
        scores.degraded = result.worst;
        expect(result.worst).toBeLessThan(0.8);
        expect(result.worstView).toBeGreaterThanOrEqual(0);
        expect(result.worstView).toBeLessThan(2);
    });

    it("renders locally decoded ETC1S, UASTC/zstd and WebP textures", async () => {
        const ktx = await new NodeAsset({ name: "renderer-ktx", outputBlock: new EncodeKTX2Block({ input: await copy(source) }) }).executeAsync();
        scores.ktx2 = (await renderer.evaluateAsync(await write(ktx))).worst;
        expect(scores.ktx2).toBeGreaterThan(0.8);

        const webp = await copy(source);
        webp.createExtension(EXTTextureWebP).setRequired(true);
        const texture = webp.getRoot().listTextures()[0]!;
        texture.setImage(await sharp(texture.getImage()!).webp({ lossless: true }).toBuffer()).setMimeType("image/webp");
        scores.webp = (await renderer.evaluateAsync(await write(webp))).worst;
        expect(scores.webp).toBeGreaterThan(0.8);
        expect(requests.some((url) => url.endsWith("/msc_basis_transcoder.wasm"))).toBe(true);
        expect(requests.some((url) => url.endsWith("/zstddec.wasm"))).toBe(true);
    }, 60_000);

    it("decodes Draco and meshopt in Node without changing fidelity", async () => {
        for (const [name, block] of [
            ["draco", new EncodeDracoBlock({ input: await copy(source) })],
            ["meshopt", new EncodeMeshoptBlock({ input: await copy(source) })],
        ] as const) {
            const output = new GltfOutputBlock();
            block.output.connectTo(output.input);
            const file = await new NodeAsset({ name: `renderer-${name}`, outputBlock: output }).executeAsync();
            const { json } = await parseGlbAsync(file);
            expect(json.extensionsUsed).toContain(name === "draco" ? "KHR_draco_mesh_compression" : "EXT_meshopt_compression");
            scores[name] = (await renderer.evaluateAsync(new Uint8Array(await file.arrayBuffer()))).worst;
            expect(scores[name]).toBeGreaterThanOrEqual(0.99);
        }
    }, 60_000);

    it("does not silently score a differing sparse object as one", async () => {
        const thin = await texturedModel(0.01);
        await renderer.setReferenceAsync(await write(thin), { size: 256, views: 1 });
        thin.getRoot().listNodes()[0]!.setTranslation([0.05, 0, 0]);
        scores.sparse = (await renderer.evaluateAsync(await write(thin))).worst;
        expect(scores.sparse).toBeLessThan(0.99);
    });

    it.each(["empty", "invisible", "one empty view"])("rejects a reference with %s geometry", async (kind) => {
        const model = kind === "empty" ? new Document() : await copy(source);
        if (kind === "empty") {
            model.createScene();
        } else if (kind === "invisible") {
            model.getRoot().listMaterials()[0]!.setAlphaMode("MASK").setBaseColorFactor([1, 1, 1, 0]);
        } else {
            model.getRoot().listMaterials()[0]!.setDoubleSided(false);
        }
        await expect(renderer.setReferenceAsync(await write(model), { size: 64, views: kind === "one empty view" ? 2 : 1 })).rejects.toMatchObject({
            code: "INVALID_INPUT",
            help: expect.any(Array),
        });
    });

    it("makes no requests outside the loopback host", () => {
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
    });
});

async function write(document: Document): Promise<Uint8Array> {
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
}

async function copy(document: Document): Promise<Document> {
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await write(document));
}

async function texturedModel(width = 1): Promise<Document> {
    const document = new Document();
    const buffer = document.createBuffer();
    const primitive = document
        .createPrimitive()
        .setAttribute(
            "POSITION",
            document
                .createAccessor()
                .setType("VEC3")
                .setArray(new Float32Array([-width, -1, 0, width, -1, 0, width, 1, 0, -width, 1, 0]))
                .setBuffer(buffer)
        )
        .setAttribute(
            "NORMAL",
            document
                .createAccessor()
                .setType("VEC3")
                .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
                .setBuffer(buffer)
        )
        .setAttribute(
            "TEXCOORD_0",
            document
                .createAccessor()
                .setType("VEC2")
                .setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
                .setBuffer(buffer)
        )
        .setIndices(
            document
                .createAccessor()
                .setType("SCALAR")
                .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
                .setBuffer(buffer)
        );
    const image = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 185, g: 95, b: 45, alpha: 1 } } })
        .png()
        .toBuffer();
    const normal = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 128, g: 128, b: 255, alpha: 1 } } })
        .png()
        .toBuffer();
    const material = document
        .createMaterial()
        .setBaseColorTexture(document.createTexture().setImage(image).setMimeType("image/png"))
        .setNormalTexture(document.createTexture().setImage(normal).setMimeType("image/png"))
        .setMetallicFactor(0.8)
        .setRoughnessFactor(0.6)
        .setDoubleSided(true);
    primitive.setMaterial(material);
    document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
    return document;
}
