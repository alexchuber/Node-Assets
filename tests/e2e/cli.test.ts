import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import cliPackage from "../../packages/cli/package.json";
import { EncodeDracoBlock, EncodeKTX2Block, EncodeMeshoptBlock, GltfInputBlock, GltfOutputBlock, NodeAsset } from "../../packages/core/src/index";
import { buildCliFixtureAsync, runNodeAsync } from "../helpers/cli";
import { generateFbxData } from "../helpers/fbx";
import { expectKtx2Image, parseGlbAsync } from "../helpers/glb";
import { generateGlbData, generateGltfJson, generateTexturedGltfJson } from "../helpers/gltf";
import { generateObjData } from "../helpers/obj";
import { generateStlData } from "../helpers/stl";

describe("Node Assets CLI", () => {
    let directory: string;
    let launcher: string;
    let input: string;
    let texturedInput: string;

    beforeAll(async () => {
        directory = await mkdtemp(fileURLToPath(new URL("../../packages/core/node_modules/.node-assets-cli-", import.meta.url)));
        launcher = await buildCliFixtureAsync(directory);
        input = join(directory, "input.gltf");
        texturedInput = join(directory, "textured.gltf");
        await writeFile(input, generateGltfJson());
        await writeFile(texturedInput, generateTexturedGltfJson());
        await writeFile(join(directory, "input.glb"), generateGlbData());
    }, 120_000);

    afterAll(async () => {
        if (directory !== undefined) {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it.each([[], ["--help"], ["-h"], ["pipeline", "--help"]].map((args) => ({ args })))("shows help for $args", async ({ args }) => {
        const result = await runNodeAsync([launcher, ...args], directory);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        for (const term of [
            "pipeline",
            ".gltf",
            ".glb",
            ".fbx",
            ".obj",
            ".stl",
            ".usd",
            ".usda",
            ".usdc",
            ".usdz",
            "draco",
            "meshopt",
            "ktx2",
            "validate",
            "quantize",
            "cull-unused",
            "strip-materials",
            "--stats",
            "--benchmark",
        ]) {
            expect(result.stdout).toContain(term);
        }
    });

    it.each(["--version", "-v"])("reports the package version with %s", async (flag) => {
        const result = await runNodeAsync([launcher, flag], directory);
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe(cliPackage.version);
        expect(result.stderr).toBe("");
    });

    it.each(
        [
            ["unknown"],
            ["pipeline"],
            ["pipeline", "input.gltf"],
            ["pipeline", "input.gltf", "unknown", "output.glb"],
            ["pipeline", "input.gltf", "DRACO", "output.glb"],
            ["pipeline", "--unknown", "input.gltf", "output.glb"],
            ["pipeline", "input.gltf", "--force", "output.glb"],
            ["pipeline", "input.ply", "output.glb"],
            ["pipeline", "input", "output.glb"],
            ["pipeline", "input.gltf", "output.gltf"],
            ["pipeline", "input.gltf", "output"],
        ].map((args) => ({ args }))
    )("rejects invalid arguments $args", async ({ args }) => {
        const cwd = await mkdtemp(join(directory, "invalid-"));
        await cp(input, join(cwd, "input.gltf"));
        await cp(input, join(cwd, "input.ply"));
        await cp(input, join(cwd, "input"));
        const before = await readdir(cwd);
        const result = await runNodeAsync([launcher, ...args], cwd);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).not.toBe("");
        expect(await readdir(cwd)).toEqual(before);
    });

    it.skipIf(typeof Worker !== "undefined")("fails without writing output when USD lacks Web Worker support", async () => {
        const cwd = await mkdtemp(join(directory, "usd-"));
        await writeFile(join(cwd, "input.usda"), "#usda 1.0\n");
        const before = await readdir(cwd);
        const result = await runNodeAsync([launcher, "pipeline", "input.usda", "output.glb"], cwd);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).not.toBe("");
        expect(await readdir(cwd)).toEqual(before);
    });

    it.each(["gltf", "glb"])("round trips a local %s without transforms", async (extension) => {
        const output = join(directory, `roundtrip-${extension}.glb`);
        const result = await runNodeAsync([launcher, "pipeline", `input.${extension}`, output], directory);
        expect(result.code).toBe(0);
        expect(result.stdout).not.toContain("Stats:");
        expect(result.stdout).not.toContain("Benchmark:");
        const document = await new NodeIO().read(output);
        expect(document.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getAttribute("POSITION")?.getArray()).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
        const parsed = await readGlbAsync(output);
        expect(parsed.json.extensionsUsed ?? []).not.toContain("KHR_draco_mesh_compression");
        expect(parsed.json.extensionsUsed ?? []).not.toContain("EXT_meshopt_compression");
    });

    it.each([
        { extension: "obj", data: generateObjData() },
        { extension: "stl", data: generateStlData() },
        { extension: "fbx", data: generateFbxData() },
    ])("converts a local $extension input to GLB", async ({ extension, data }) => {
        const source = join(directory, `source.${extension}`);
        const output = join(directory, `${extension}-input.glb`);
        await writeFile(source, data);

        const result = await runNodeAsync([launcher, "pipeline", source, output], directory);

        expect(result.code).toBe(0);
        expect((await readGlbAsync(output)).json.meshes).toHaveLength(1);
    });

    it.skipIf(typeof Worker === "undefined" && !process.allowedNodeEnvironmentFlags.has("--experimental-web-worker"))(
        "converts a local USDA input to GLB when Web Workers are available",
        async () => {
            const source = join(directory, "source.usda");
            const output = join(directory, "usda-input.glb");
            await writeFile(
                source,
                '#usda 1.0\n(\n    defaultPrim = "Root"\n)\ndef Xform "Root"\n{\n    def Mesh "Tri"\n    {\n        int[] faceVertexCounts = [3]\n        int[] faceVertexIndices = [0, 1, 2]\n        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n    }\n}\n'
            );
            const flags = typeof Worker === "undefined" ? ["--experimental-web-worker"] : [];

            const result = await runNodeAsync([...flags, launcher, "pipeline", source, output], directory);

            expect(result.code).toBe(0);
            expect((await readGlbAsync(output)).json.meshes).toHaveLength(1);
        }
    );

    it.each([
        { extension: "gltf", flags: ["--stats"] },
        { extension: "glb", flags: ["--stats"] },
        { extension: "glb", flags: ["--benchmark"] },
        { extension: "glb", flags: ["--stats", "--benchmark"] },
    ])("reports requested metrics for $extension with $flags", async ({ extension, flags }) => {
        const source = join(directory, `input.${extension}`);
        const output = join(directory, `report-${extension}-${flags.join("-")}.glb`);
        const result = await runNodeAsync([launcher, "pipeline", source, "draco", output, ...flags], directory);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect((await readGlbAsync(output)).json.extensionsUsed).toContain("KHR_draco_mesh_compression");
        expect(result.stdout).toContain(`Wrote ${output}`);

        if (flags.includes("--stats")) {
            expect(result.stdout).toContain(`Stats:\n  Total size before: ${(await stat(source)).size} B\n  Total size after: ${(await stat(output)).size} B`);
        } else {
            expect(result.stdout).not.toContain("Stats:");
        }

        if (flags.includes("--benchmark")) {
            expect(result.stdout).toContain("Benchmark:");
            for (const label of ["Completion time", "CPU time (user)", "CPU time (system)"]) {
                const line = result.stdout.split("\n").find((line) => line.startsWith(`  ${label}: `));
                expect(line).toMatch(/: \d+\.\d{2} (?:ms|s|min|h)$/u);
                const value = Number(line?.split(": ")[1]?.split(" ")[0]);
                expect(value).toBeGreaterThanOrEqual(0);
                if (label === "Completion time") {
                    expect(value).toBeGreaterThan(0);
                }
            }
            for (const label of ["RSS", "Peak RSS (process lifetime)", "Heap used"]) {
                const line = result.stdout.split("\n").find((line) => line.startsWith(`  ${label}: `));
                expect(line).toMatch(/: (?:\d+ B|\d+\.\d{2} (?:KiB|MiB|GiB|TiB|PiB))$/u);
                expect(Number(line?.split(": ")[1]?.split(" ")[0])).toBeGreaterThan(0);
                expect(Number(line?.split(": ")[1]?.split(" ")[0])).toBeLessThan(1_024);
            }
        } else {
            expect(result.stdout).not.toContain("Benchmark:");
        }
    });

    it.each([
        { bytes: 1_023, expected: "1023 B", divisor: 1 },
        { bytes: 1_024, expected: "1.00 KiB", divisor: 1_024 },
        { bytes: 1_536, expected: "1.50 KiB", divisor: 1_024 },
        { bytes: 1_048_575, expected: "1.00 MiB", divisor: 1_048_576 },
        { bytes: 1_048_576, expected: "1.00 MiB", divisor: 1_048_576 },
        { bytes: 1_310_720, expected: "1.25 MiB", divisor: 1_048_576 },
    ])("formats input sizes of $bytes bytes as $expected and keeps the unit for output", async ({ bytes, expected, divisor }) => {
        const source = join(directory, `size-${bytes}.gltf`);
        const output = join(directory, `size-${bytes}.glb`);
        await writeFile(source, generateGltfJson().padEnd(bytes, " "));

        const result = await runNodeAsync([launcher, "pipeline", source, output, "--stats"], directory);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain(`Total size before: ${expected}`);
        const outputBytes = (await stat(output)).size;
        expect(result.stdout).toContain(`Total size after: ${divisor === 1 ? outputBytes : (outputBytes / divisor).toFixed(2)} ${expected.split(" ")[1]}`);
    });

    it.each([
        { padding: 960, unit: "B" },
        { padding: 2_048, unit: "KiB" },
    ])("formats output sizes using the input's $unit unit even when output grows", async ({ padding, unit }) => {
        const source = join(directory, `large-output-${unit}.gltf`);
        const output = join(directory, `large-output-${unit}.glb`);
        await writeFile(source, JSON.stringify({ asset: { version: "2.0" }, extras: { label: "x".repeat(padding) } }));

        const result = await runNodeAsync([launcher, "pipeline", source, output, "--stats"], directory);
        expect(result.code).toBe(0);
        const outputBytes = (await stat(output)).size;
        expect(outputBytes).toBeGreaterThan(1_024);
        expect(outputBytes).toBeLessThan(1_048_576);
        expect(result.stdout).toContain(`Total size after: ${unit === "B" ? outputBytes : (outputBytes / 1_024).toFixed(2)} ${unit}`);
    });

    it.each([
        { milliseconds: 0, completion: "0.00 ms", user: "0.00 ms", system: "0.00 ms" },
        { milliseconds: 12.34, completion: "12.34 ms", user: "24.68 ms", system: "6.17 ms" },
        { milliseconds: 999.994, completion: "999.99 ms", user: "1999.99 ms", system: "500.00 ms" },
        { milliseconds: 999.999, completion: "1.00 s", user: "2.00 s", system: "0.50 s" },
        { milliseconds: 1_000, completion: "1.00 s", user: "2.00 s", system: "0.50 s" },
        { milliseconds: 2_538.93, completion: "2.54 s", user: "5.08 s", system: "1.27 s" },
        { milliseconds: 59_999, completion: "1.00 min", user: "2.00 min", system: "0.50 min" },
        { milliseconds: 60_000, completion: "1.00 min", user: "2.00 min", system: "0.50 min" },
        { milliseconds: 72_471.94, completion: "1.21 min", user: "2.42 min", system: "0.60 min" },
        { milliseconds: 3_599_990, completion: "1.00 h", user: "2.00 h", system: "0.50 h" },
        { milliseconds: 3_600_000, completion: "1.00 h", user: "2.00 h", system: "0.50 h" },
        { milliseconds: 5_400_000, completion: "1.50 h", user: "3.00 h", system: "0.75 h" },
    ])("formats $milliseconds ms using the completion-time unit for every timing row", async ({ milliseconds, completion, user, system }) => {
        const output = join(directory, `timing-${milliseconds}.glb`);
        // Keep the real pipeline, but control clocks in a child process to cover long runs without waiting.
        const script = `
            const { runCliAsync } = await import(${JSON.stringify(new URL("../dist/cli.js", pathToFileURL(launcher)).href)});
            let started = false;
            process.hrtime.bigint = () => {
                if (!started) {
                    started = true;
                    return 0n;
                }
                return ${BigInt(Math.round(milliseconds * 1_000_000))}n;
            };
            process.cpuUsage = (previous) => previous === undefined
                ? { user: 0, system: 0 }
                : ${JSON.stringify({ user: Math.round(milliseconds * 2_000), system: Math.round(milliseconds * 500) })};
            await runCliAsync(${JSON.stringify(["pipeline", input, output, "--benchmark"])});
        `;
        const result = await runNodeAsync(["--input-type=module", "--eval", script], directory);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`Completion time: ${completion}`);
        expect(result.stdout).toContain(`CPU time (user): ${user}`);
        expect(result.stdout).toContain(`CPU time (system): ${system}`);
        expect((await readGlbAsync(output)).json.meshes).toHaveLength(1);
    });

    it("resolves sibling glTF resources from the input path", async () => {
        const sourceDirectory = join(directory, "external");
        await mkdir(sourceDirectory);
        const io = new NodeIO();
        await io.write(join(sourceDirectory, "model.gltf"), await io.read(input));
        expect(await readdir(sourceDirectory)).toContain("model.bin");

        const output = join(directory, "external.glb");
        const result = await runNodeAsync([launcher, "pipeline", "external/model.gltf", output], directory);
        expect(result.code).toBe(0);
        expect((await io.read(output)).getRoot().listMeshes()).toHaveLength(1);
    });

    it("accepts uppercase extensions and relative paths with spaces from another directory", async () => {
        const cwd = join(directory, "working directory");
        await mkdir(cwd);
        await cp(input, join(cwd, "source file.GLTF"));
        const result = await runNodeAsync([launcher, "pipeline", "source file.GLTF", "output file.GLB"], cwd);
        expect(result.code).toBe(0);
        expect((await new NodeIO().read(join(cwd, "output file.GLB"))).getRoot().listMeshes()).toHaveLength(1);
    });

    it("accepts hyphen-prefixed paths after the option terminator", async () => {
        const cwd = await mkdtemp(join(directory, "hyphens-"));
        await cp(input, join(cwd, "-input.gltf"));
        const result = await runNodeAsync([launcher, "--", "pipeline", "-input.gltf", "-output.glb"], cwd);
        expect(result.code).toBe(0);
        expect((await new NodeIO().read(join(cwd, "-output.glb"))).getRoot().listMeshes()).toHaveLength(1);
    });

    it.each([
        { blocks: ["validate"], geometry: undefined, ktx2: false },
        { blocks: ["draco"], geometry: "KHR_draco_mesh_compression", ktx2: false },
        { blocks: ["meshopt"], geometry: "EXT_meshopt_compression", ktx2: false },
        { blocks: ["ktx2"], geometry: undefined, ktx2: true },
        { blocks: ["validate", "draco", "validate"], geometry: "KHR_draco_mesh_compression", ktx2: false },
        { blocks: ["meshopt", "validate"], geometry: "EXT_meshopt_compression", ktx2: false },
        { blocks: ["ktx2", "validate"], geometry: undefined, ktx2: true },
        { blocks: ["ktx2", "draco"], geometry: "KHR_draco_mesh_compression", ktx2: true },
        { blocks: ["ktx2", "meshopt"], geometry: "EXT_meshopt_compression", ktx2: true },
    ])(
        "encodes $blocks through the built package",
        async ({ blocks, geometry, ktx2 }) => {
            const output = join(directory, `${blocks.join("-")}.glb`);
            const result = await runNodeAsync([launcher, "pipeline", texturedInput, ...blocks, output], directory);
            expect(result.code).toBe(0);
            const parsed = await readGlbAsync(output);
            if (geometry !== undefined) {
                expect(parsed.json.extensionsUsed).toContain(geometry);
                if (geometry === "KHR_draco_mesh_compression") {
                    expect(parsed.json.meshes?.[0]?.primitives[0]?.extensions?.KHR_draco_mesh_compression).toBeDefined();
                } else {
                    expect(parsed.json.bufferViews?.some(({ extensions }) => extensions?.EXT_meshopt_compression !== undefined)).toBe(true);
                }
            }
            if (ktx2) {
                expect(parsed.json.extensionsUsed).toContain("KHR_texture_basisu");
                expectKtx2Image(parsed);
            }
        },
        60_000
    );

    it("quantizes mesh attributes", async () => {
        const output = join(directory, "quantized.glb");
        const result = await runNodeAsync([launcher, "pipeline", input, "quantize", output], directory);

        expect(result.code).toBe(0);
        expect((await readGlbAsync(output)).json.extensionsUsed).toContain("KHR_mesh_quantization");
    });

    it("culls unused resources", async () => {
        const source = join(directory, "unused-material.gltf");
        const output = join(directory, "culled.glb");
        const gltf = JSON.parse(generateGltfJson()) as { materials?: unknown[] };
        gltf.materials = [{ name: "Unused" }];
        await writeFile(source, JSON.stringify(gltf));

        const result = await runNodeAsync([launcher, "pipeline", source, "cull-unused", output], directory);

        expect(result.code).toBe(0);
        expect((await readGlbAsync(output)).json.materials).toBeUndefined();
    });

    it("strips materials and their unused textures", async () => {
        const output = join(directory, "stripped.glb");
        const result = await runNodeAsync([launcher, "pipeline", texturedInput, "strip-materials", output], directory);

        expect(result.code).toBe(0);
        const { json } = await readGlbAsync(output);
        expect(json.materials).toBeUndefined();
        expect(json.textures).toBeUndefined();
        expect(json.images).toBeUndefined();
    });

    it("prints validation diagnostics and writes output for a valid document", async () => {
        const source = join(directory, "validate-warnings.gltf");
        const output = join(directory, "validate-warnings.glb");
        const io = new NodeIO();
        const document = await io.read(input);
        document.createNode();
        await io.write(source, document);

        const result = await runNodeAsync([launcher, "pipeline", source, "validate", output], directory);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain("\u2705 glTF is valid");
        expect(result.stdout).toContain("[Warning]");
        expect(result.stdout).toContain("at /nodes/1");
        expect((await readGlbAsync(output)).json.meshes).toHaveLength(1);
    });

    it("fails validation without creating output or printing success reports", async () => {
        const source = join(directory, "validate-invalid.gltf");
        const output = join(directory, "validate-invalid.glb");
        const io = new NodeIO();
        const document = await io.read(input);
        document
            .getRoot()
            .listAccessors()[2]!
            .setArray(new Uint16Array([0, 1, 99]));
        await io.write(source, document);

        const result = await runNodeAsync([launcher, "pipeline", source, "validate", output, "--stats", "--benchmark"], directory);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain("[Error]");
        expect(result.stdout).not.toContain("is valid");
        expect(result.stdout).not.toContain("Wrote ");
        expect(result.stdout).not.toContain("Stats:");
        expect(result.stdout).not.toContain("Benchmark:");
        expect(result.stderr.trim()).not.toBe("");
        await expect(readFile(output)).rejects.toThrow();
    });

    it.each([
        { blocks: ["draco", "draco"], first: EncodeDracoBlock, second: EncodeDracoBlock },
        { blocks: ["ktx2", "ktx2"], first: EncodeKTX2Block, second: EncodeKTX2Block },
        { blocks: ["draco", "meshopt"], first: EncodeDracoBlock, second: EncodeMeshoptBlock },
        { blocks: ["meshopt", "draco"], first: EncodeMeshoptBlock, second: EncodeDracoBlock },
    ])(
        "matches library behavior for $blocks without imposing restrictions",
        async ({ blocks, first: FirstBlock, second: SecondBlock }) => {
            const source = new GltfInputBlock({ input: texturedInput });
            const first = new FirstBlock();
            const second = new SecondBlock();
            const destination = new GltfOutputBlock();
            source.output.connectTo(first.input);
            first.output.connectTo(second.input);
            second.output.connectTo(destination.input);
            const asset = new NodeAsset({ name: "reference", outputBlock: destination });
            const output = join(directory, `sequence-${blocks.join("-")}.glb`);

            try {
                const [reference] = await Promise.allSettled([asset.executeAsync()]);
                const result = await runNodeAsync([launcher, "pipeline", texturedInput, ...blocks, output], directory);
                if (reference?.status === "fulfilled") {
                    expect(result.code).toBe(0);
                    expect((await readGlbAsync(output)).json).toEqual((await parseGlbAsync(reference.value)).json);
                } else {
                    expect(result.code).toBe(1);
                    expect(result.stderr.trim()).not.toBe("");
                    await expect(readFile(output)).rejects.toThrow();
                }
            } finally {
                asset.dispose();
            }
        },
        60_000
    );

    it.each([[], ["--stats", "--benchmark"]].map((flags) => ({ flags })))("does not overwrite an existing destination with $flags", async ({ flags }) => {
        const output = join(directory, `existing-${flags.join("-")}.glb`);
        const original = Buffer.from("keep this file");
        await writeFile(output, original);
        const result = await runNodeAsync([launcher, ...flags, "pipeline", input, output], directory);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).not.toBe("");
        expect(result.stdout).not.toContain("Wrote ");
        expect(result.stdout).not.toContain("Stats:");
        expect(result.stdout).not.toContain("Benchmark:");
        expect(await readFile(output)).toEqual(original);
    });

    it("does not overwrite the input through an equivalent relative output path", async () => {
        const source = join(directory, "input.glb");
        const original = await readFile(source);
        const result = await runNodeAsync([launcher, "pipeline", source, relative(directory, source)], directory);
        expect(result.code).toBe(1);
        expect(await readFile(source)).toEqual(original);
    });

    it.each(["missing", "malformed", "directory"])("surfaces a %s input without creating output", async (kind) => {
        const source = join(directory, `${kind}.gltf`);
        const output = join(directory, `${kind}.glb`);
        if (kind === "malformed") {
            await writeFile(source, "not glTF");
        } else if (kind === "directory") {
            await mkdir(source);
        }
        const result = await runNodeAsync([launcher, "pipeline", source, output], directory);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).not.toBe("");
        await expect(readFile(output)).rejects.toThrow();
    });

    it("surfaces a missing output parent without creating directories", async () => {
        const parent = join(directory, "missing-parent");
        const result = await runNodeAsync([launcher, "pipeline", input, join(parent, "output.glb")], directory);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).not.toBe("");
        await expect(readdir(parent)).rejects.toThrow();
    });

    it("refuses a directory destination", async () => {
        const output = join(directory, "destination.glb");
        await mkdir(output);
        const result = await runNodeAsync([launcher, "pipeline", input, output], directory);
        expect(result.code).toBe(1);
        expect(result.stderr.trim()).not.toBe("");
        expect(await readdir(output)).toEqual([]);
    });
});

async function readGlbAsync(path: string) {
    const bytes = await readFile(path);
    return parseGlbAsync(new File([bytes], "scene.glb", { type: "model/gltf-binary" }));
}
