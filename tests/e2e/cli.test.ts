import { randomUUID } from "node:crypto";
import { cp, link, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import cliPackage from "../../packages/cli/package.json";
import { inputBytes, inputHash } from "../../packages/cli/src/inputs";
import { decode, serialize } from "../../packages/cli/src/output";
import { readProvenance } from "../../packages/cli/src/provenance";
import { findBrowser } from "../../packages/cli/src/render";
import { buildCliFixtureAsync, runNodeAsync } from "../helpers/cli";
import { createGridDocument } from "../helpers/document";
import { generateGlbData, generateGltfJson } from "../helpers/gltf";

const browser = await findBrowser().catch(() => undefined);

describe("node-assets CLI", () => {
    let directory: string;
    let launcher: string;
    let input: string;
    let sourceBytes: Uint8Array;

    const run = (args: readonly string[], cwd = directory) => runNodeAsync([launcher, ...args], cwd);
    const parse = (text: string) => decode(text) as Record<string, unknown>;

    beforeAll(async () => {
        directory = resolve(`_cli-test-${randomUUID()}`);
        await mkdir(directory);
        launcher = await buildCliFixtureAsync(directory, !!browser);
        input = join(directory, "input.glb");
        const doc = await new NodeIO().readBinary(generateGlbData());
        doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(doc.createMaterial().setDoubleSided(true));
        sourceBytes = await new NodeIO().writeBinary(doc);
        await writeFile(input, sourceBytes);
    }, 120_000);

    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it.each(["--version", "-v", "-V"])("reports the bare version with %s", async (flag) => {
        const result = await run([flag]);
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe(cliPackage.version);
        expect(result.stderr).toBe("");
    });

    it("answers version without loading a CLI bundle", async () => {
        const isolated = join(directory, ".version-only");
        await mkdir(isolated);
        await cp("packages/cli/bin", join(isolated, "bin"), { recursive: true });
        await cp("packages/cli/package.json", join(isolated, "package.json"));
        const result = await runNodeAsync([join(isolated, "bin/node-assets.cjs"), "--version"], isolated);
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe(cliPackage.version);
    });

    it("keeps version latency close to the Node startup floor", async () => {
        const floorStart = performance.now();
        await runNodeAsync(["-e", "process.stdout.write('1')"], directory);
        const floor = performance.now() - floorStart;
        const versionStart = performance.now();
        const result = await run(["--version"]);
        expect(result.code).toBe(0);
        expect(performance.now() - versionStart).toBeLessThan(floor * 5);
    });

    it("prints the bundled manual", async () => {
        const result = await run(["help"]);
        expect(result.code).toBe(0);
        const source = await readFile("packages/cli/docs/node-assets.1.md", "utf8");
        expect(result.stdout).toBe(source.match(/```text\n([\s\S]*?)\n```/)![1] + "\n");
    });

    it.each(["inspect", "run", "show", "tune", "help"])("prints complete help for %s", async (command) => {
        const result = await run([command, "--help"]);
        expect(result.code).toBe(0);
        expect(parse(result.stdout)).toMatchObject({ usage: expect.any(String), description: expect.any(String), flags: expect.any(Array), examples: expect.any(Array) });
    });

    it.each([
        ["unknown"],
        ["pipeline"],
        ["run", "--unknown"],
        ["inspect", "--unknown"],
        ["show", "--unknown"],
        ["tune", "--unknown"],
        ["help", "--unknown"],
        ["show", "optimize", "extra"],
        ["run", "optimize", "input.glb"],
        ["run", "optimize", "input.glb", "-o", "out.gltf"],
        ["inspect", "input.glb", "--network", "invalid"],
        ["inspect", "input.glb", "--view", "128junk"],
    ])("rejects usage errors %#", async (...args: string[]) => {
        const result = await run(args);
        expect(result.code).toBe(2);
        expect(parse(result.stdout).code).toBe("USAGE");
    });

    it("shows models and graph files, largest first, skipping hidden and excluded directories", async () => {
        const cwd = join(directory, "home");
        await mkdir(join(cwd, "a/b/c/d"), { recursive: true });
        await mkdir(join(cwd, "node_modules"));
        await mkdir(join(cwd, "dist"));
        await mkdir(join(cwd, ".hidden"));
        await writeFile(join(cwd, "small.glb"), "1");
        await writeFile(join(cwd, "a/large.obj"), "12345");
        for (const path of ["a/b/c/deep.glb", "a/b/c/d/too-deep.glb", "node_modules/skip.glb", "dist/skip.glb", ".hidden/skip.glb", ".skip.glb"])
            await writeFile(join(cwd, path), "1");
        await writeFile(join(cwd, "mine.toon"), serialize({ graph: 1, blocks: [{ type: "transform.dedup" }] }));
        await writeFile(join(cwd, "not-a-graph.toon"), "other: 1\n");
        const result = await run([], cwd);
        expect(result.code).toBe(0);
        const value = parse(result.stdout);
        expect((value.models as { file: string }[]).map((model) => model.file)).toEqual(["a/large.obj", "a/b/c/deep.glb", "small.glb"]);
        expect(value.graphs).toEqual([{ file: "mine.toon", bytes: (await stat(join(cwd, "mine.toon"))).size }]);
        expect(value.builtins).toEqual([expect.objectContaining({ name: "optimize", file: expect.stringMatching(/optimize\.toon$/) })]);
    });

    it("shows default configurations and round trips through a graph file", async () => {
        const shown = await run(["show", "optimize"]);
        expect(shown.code).toBe(0);
        const value = parse(shown.stdout);
        expect(value.graph).toBe(1);
        expect(value.blocks).toContainEqual({ type: "transform.encode-textures", config: { format: "webp", quality: 90, slots: "color" } });
        const file = join(directory, "round-trip.toon");
        await writeFile(file, shown.stdout);
        const roundTrip = await run(["show", file]);
        expect(roundTrip.code).toBe(0);
        expect(parse(roundTrip.stdout)).toEqual(value);
    });

    it("runs optimize and preserves the output on an identical re-run", async () => {
        const output = join(directory, "optimized.glb");
        const first = await run(["run", "optimize", input, "-o", output]);
        expect(first.code, first.stdout).toBe(0);
        expect((await stat(output)).size).toBeGreaterThan(0);
        expect(await readProvenance(output)).toMatchObject({ graph: expect.stringMatching(/^[a-f0-9]{12}$/), input: expect.stringMatching(/^[a-f0-9]{12}$/) });
        const before = await stat(output);
        const second = await run(["run", "optimize", input, "-o", output]);
        expect(second.code).toBe(0);
        expect(parse(second.stdout).results).toEqual([expect.objectContaining({ status: "up to date (no-op)" })]);
        expect((await stat(output)).mtimeMs).toBe(before.mtimeMs);
        expect(await readFile(input)).toEqual(Buffer.from(sourceBytes));
    });

    it("requires --force for unrelated outputs and replaces atomically", async () => {
        const output = join(directory, "existing.glb");
        await writeFile(output, "existing");
        const failed = await run(["run", "optimize", input, "-o", output]);
        expect(failed.code).toBe(1);
        expect(parse(failed.stdout).code).toBe("OUTPUT_EXISTS");
        expect(await readFile(output, "utf8")).toBe("existing");
        const forced = await run(["run", "optimize", input, "-o", output, "--force"]);
        expect(forced.code, forced.stdout).toBe(0);
        expect(await readProvenance(output)).not.toBeNull();
        expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });

    it("collects directory inputs non-recursively and writes directory outputs", async () => {
        const sources = join(directory, "sources");
        const outputs = join(directory, "outputs");
        await mkdir(sources);
        await writeFile(join(sources, "one.glb"), generateGlbData());
        await writeFile(join(sources, "two.glb"), generateGlbData());
        await writeFile(join(sources, ".hidden.glb"), generateGlbData());
        await writeFile(join(sources, "note.txt"), "");
        await writeFile(join(sources, "export.blend"), "");
        const result = await run(["run", "optimize", sources, "-o", outputs + "/"]);
        expect(result.code, result.stdout).toBe(0);
        expect((await readdir(outputs)).sort()).toEqual(["one.glb", "two.glb"]);
        expect(parse(result.stdout).results).toContainEqual(expect.objectContaining({ status: "skipped" }));
        const bad = await run(["run", "optimize", sources, "-o", "one.glb"]);
        expect(bad.code).toBe(2);
    });

    it.each(["direct", "symlink", "hardlink"])("never overwrites an input through %s", async (kind) => {
        let output = input;
        if (kind !== "direct") {
            output = join(directory, `${kind}.glb`);
            if (kind === "symlink") await symlink(input, output);
            else await link(input, output);
        }
        const result = await run(["run", "optimize", input, "-o", output, "--force"]);
        expect(result.code).toBe(2);
        expect(parse(result.stdout).code).toBe("USAGE");
        expect(await readFile(input)).toEqual(Buffer.from(sourceBytes));
    });

    it("never overwrites an input through a symlinked parent and unresolved dot segments", async () => {
        const cwd = join(directory, "symlink-parent");
        const nested = join(cwd, "target/nested");
        await mkdir(nested, { recursive: true });
        const victim = join(cwd, "target/victim.glb");
        await writeFile(victim, sourceBytes);
        await symlink(nested, join(cwd, "alias"), "dir");
        const output = `${cwd}/alias/missing/../../victim.glb`;
        const result = await run(["run", "optimize", victim, "-o", output, "--force"]);
        expect(result.code).toBe(2);
        expect(parse(result.stdout).code).toBe("USAGE");
        expect(await readFile(victim)).toEqual(Buffer.from(sourceBytes));
    });

    it("uses one canonical input for conversion, hashing, and byte accounting", async () => {
        const cwd = join(directory, "canonical-input");
        await mkdir(join(cwd, "target/nested"), { recursive: true });
        const canonical = join(cwd, "target/victim.glb");
        const original = await new NodeIO().writeBinary(createGridDocument(1));
        await writeFile(canonical, original);
        await writeFile(join(cwd, "victim.glb"), sourceBytes);
        await symlink(join(cwd, "target/nested"), join(cwd, "alias"), "dir");
        const result = await run(["run", "optimize", "alias/../victim.glb", "-o", "out/"], cwd);
        expect(result.code, result.stdout).toBe(0);
        expect(parse(result.stdout).results).toContainEqual(expect.objectContaining({ input: "alias/../victim.glb", bytes_before: original.length }));
        const output = join(cwd, "out/victim.glb");
        expect(await readProvenance(output)).toMatchObject({ input: await inputHash(canonical) });
        const inspected = await run(["inspect", output], cwd);
        expect(inspected.code, inspected.stdout).toBe(0);
        expect(parse(inspected.stdout).triangles).toBe(2);
        expect(await readFile(canonical)).toEqual(Buffer.from(original));
        expect(await readFile(join(cwd, "victim.glb"))).toEqual(Buffer.from(sourceBytes));
    });

    it("uses the supplied input basename while retaining the supplied display path", async () => {
        const cwd = join(directory, "canonical-basename");
        await mkdir(join(cwd, "target"), { recursive: true });
        await writeFile(join(cwd, "target/actual.glb"), sourceBytes);
        await symlink(join(cwd, "target/actual.glb"), join(cwd, "display.glb"));
        const result = await run(["run", "optimize", "display.glb", "-o", "out/"], cwd);
        expect(result.code, result.stdout).toBe(0);
        expect(await readdir(join(cwd, "out"))).toEqual(["display.glb"]);
        expect(parse(result.stdout).results).toContainEqual(expect.objectContaining({ input: "display.glb" }));
    });

    it("inspects the canonical input rather than a lexically normalized alternative", async () => {
        const cwd = join(directory, "canonical-inspect");
        await mkdir(join(cwd, "target/nested"), { recursive: true });
        const canonical = join(cwd, "target/victim.gltf");
        await new NodeIO().write(canonical, createGridDocument(1));
        await writeFile(join(cwd, "victim.gltf"), generateGltfJson());
        await symlink(join(cwd, "target/nested"), join(cwd, "alias"), "dir");
        const result = await run(["inspect", "alias/../victim.gltf"], cwd);
        expect(result.code, result.stdout).toBe(0);
        expect(parse(result.stdout)).toMatchObject({ file: "alias/../victim.gltf", triangles: 2, bytes: await inputBytes(canonical) });
    });

    it("rejects case-insensitive batch output collisions before writing anything", async () => {
        const cwd = join(directory, "case-collision");
        await mkdir(join(cwd, "one"), { recursive: true });
        await mkdir(join(cwd, "two"));
        await writeFile(join(cwd, "one/part.glb"), sourceBytes);
        await writeFile(join(cwd, "two/PART.glb"), sourceBytes);
        const result = await run(["run", "optimize", "one/part.glb", "two/PART.glb", "-o", "out/"], cwd);
        expect(result.code).toBe(2);
        expect(parse(result.stdout).code).toBe("USAGE");
        expect((await readdir(cwd)).sort()).toEqual(["one", "two"]);
        expect(await readFile(join(cwd, "one/part.glb"))).toEqual(Buffer.from(sourceBytes));
        expect(await readFile(join(cwd, "two/PART.glb"))).toEqual(Buffer.from(sourceBytes));
    });

    it("rejects collisions between supplied symlink basenames before writing anything", async () => {
        const cwd = join(directory, "symlink-name-collision");
        await mkdir(join(cwd, "one"), { recursive: true });
        await mkdir(join(cwd, "two"));
        await mkdir(join(cwd, "target"));
        const first = join(cwd, "target/first.glb");
        const second = join(cwd, "target/second.glb");
        await writeFile(first, sourceBytes);
        await writeFile(second, sourceBytes);
        await symlink(first, join(cwd, "one/display.glb"));
        await symlink(second, join(cwd, "two/DISPLAY.glb"));
        const result = await run(["run", "optimize", "one/display.glb", "two/DISPLAY.glb", "-o", "out/"], cwd);
        expect(result.code).toBe(2);
        expect(parse(result.stdout).code).toBe("USAGE");
        expect((await readdir(cwd)).sort()).toEqual(["one", "target", "two"]);
        expect(await readFile(first)).toEqual(Buffer.from(sourceBytes));
        expect(await readFile(second)).toEqual(Buffer.from(sourceBytes));
    });

    it.each([{ type: "transform.unknown" }, { type: "transform.encode-textures", config: { quality: 101 } }])("reports BAD_GRAPH for invalid blocks %#", async (block) => {
        const file = join(directory, `bad-${randomUUID()}.toon`);
        await writeFile(file, serialize({ graph: 1, blocks: [block] }));
        const result = await run(["run", file, input, "-o", join(directory, "bad-output.glb")]);
        expect(result.code).toBe(1);
        expect(parse(result.stdout).code).toBe("BAD_GRAPH");
    });

    it("inspects a generated GLB without a browser", async () => {
        const result = await run(["inspect", input]);
        expect(result.code, result.stdout).toBe(0);
        expect(parse(result.stdout)).toMatchObject({
            status: "ok",
            bytes: (await stat(input)).size,
            gpu_mib: expect.any(Number),
            load_s: expect.any(Number),
            triangles: 1,
            textures: "none",
            decoders: "none",
            required_extensions: "none",
        });
    });

    it("reports missing and invalid inputs with structured error codes", async () => {
        const missing = await run(["inspect", join(directory, "missing.glb")]);
        expect(missing.code).toBe(1);
        expect(parse(missing.stdout).code).toBe("INPUT_NOT_FOUND");
        const corrupt = join(directory, "corrupt.glb");
        await writeFile(corrupt, "bad");
        const invalid = await run(["inspect", corrupt]);
        expect(invalid.code).toBe(1);
        expect(parse(invalid.stdout).code).toBe("INVALID_INPUT");
    });

    it("hashes referenced resources and invalidates provenance when they change", async () => {
        const cwd = join(directory, "external");
        await mkdir(cwd);
        const value = JSON.parse(generateGltfJson()) as { buffers: { uri: string }[] };
        const buffer = Buffer.from(value.buffers[0]!.uri.split(",")[1]!, "base64");
        value.buffers[0]!.uri = "mesh.bin";
        const path = join(cwd, "model.gltf");
        await writeFile(path, JSON.stringify(value));
        await writeFile(join(cwd, "mesh.bin"), buffer);
        expect(await inputBytes(path)).toBe((await stat(path)).size + buffer.length);
        const before = await inputHash(path);
        buffer[0] = 1;
        await writeFile(join(cwd, "mesh.bin"), buffer);
        expect(await inputHash(path)).not.toBe(before);
    });

    describe.skipIf(!browser)("browser-dependent CLI", () => {
        it("checks an unchanged output and checks an existing no-op without rewriting", async () => {
            const graph = join(directory, "check.toon");
            const output = join(directory, "checked.glb");
            await writeFile(graph, serialize({ graph: 1, blocks: [{ type: "transform.dedup" }], check: { fidelity: 0.9, view: 64 } }));
            const result = await run(["run", graph, input, "-o", output, "--check"]);
            expect(result.code, result.stdout).toBe(0);
            expect(parse(result.stdout).results).toContainEqual(expect.objectContaining({ check: "pass", fidelity: expect.any(Number) }));
            const before = (await stat(output)).mtimeMs;
            const noop = await run(["run", graph, input, "-o", output, "--check"]);
            expect(noop.code, noop.stdout).toBe(0);
            expect(parse(noop.stdout).results).toContainEqual(expect.objectContaining({ status: "up to date (no-op)", check: "pass" }));
            expect((await stat(output)).mtimeMs).toBe(before);
        }, 60_000);

        it("writes the output but fails a check when textures are heavily degraded", async () => {
            const doc = createGridDocument(2);
            const textureData = Buffer.alloc(64 * 64 * 3);
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const offset = (y * 64 + x) * 3;
                    const red = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
                    textureData.set(red ? [255, 0, 0] : [0, 255, 255], offset);
                }
            }
            const png = await sharp(textureData, { raw: { width: 64, height: 64, channels: 3 } })
                .png()
                .toBuffer();
            const texture = doc.createTexture().setImage(png).setMimeType("image/png");
            const material = doc.createMaterial().setBaseColorTexture(texture).setDoubleSided(true).setRoughnessFactor(1).setMetallicFactor(0);
            const primitive = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
            const buffer = doc.getRoot().listBuffers()[0]!;
            const positions = primitive.getAttribute("POSITION")!.getArray()!;
            const uv: number[] = [];
            for (let i = 0; i < positions.length; i += 3) uv.push(positions[i]!, positions[i + 1]!);
            primitive.setMaterial(material).setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer));
            const source = join(directory, "textured.glb");
            await writeFile(source, await new NodeIO().writeBinary(doc));
            const graph = join(directory, "degrade.toon");
            await writeFile(graph, serialize({ graph: 1, blocks: [{ type: "transform.resize-textures", config: { maxSize: 1 } }], check: { fidelity: 0.99, view: 64 } }));
            const output = join(directory, "degraded.glb");
            const result = await run(["run", graph, source, "-o", output, "--check"]);
            expect(result.code, result.stdout).toBe(1);
            expect(parse(result.stdout).results).toContainEqual(expect.objectContaining({ status: "below limit", check: "fail" }));
            expect((await stat(output)).size).toBeGreaterThan(0);
        }, 60_000);

        it("compares against the same-named original in a directory", async () => {
            const result = await run(["inspect", input, "--against", directory, "--view", "64"]);
            expect(result.code, result.stdout).toBe(0);
            const value = parse(result.stdout);
            expect(value.fidelity).toBeGreaterThanOrEqual(0.999);
            expect(value.original).toMatchObject({ bytes: (await stat(input)).size, gpu_mib: expect.any(Number), load_s: expect.any(Number) });
        }, 60_000);

        it("matches the supplied symlink name against an original in a directory", async () => {
            const cwd = join(directory, "symlink-original-name");
            await mkdir(join(cwd, "target"), { recursive: true });
            await mkdir(join(cwd, "originals"));
            const target = join(cwd, "target/actual.glb");
            await writeFile(target, sourceBytes);
            await writeFile(join(cwd, "originals/display.glb"), sourceBytes);
            await symlink(target, join(cwd, "display.glb"));
            const result = await run(["inspect", "display.glb", "--against", "originals", "--view", "64"], cwd);
            expect(result.code, result.stdout).toBe(0);
            const value = parse(result.stdout);
            expect(value).toMatchObject({ file: "display.glb", against: "originals/display.glb" });
            expect(value.fidelity).toBeGreaterThanOrEqual(0.999);
            expect(value.original).toMatchObject({ file: "originals/display.glb", bytes: sourceBytes.length });
        }, 60_000);

        it("restores an earlier reference after another original fails to render", async () => {
            const cwd = join(directory, "reference-reset");
            const candidates = join(cwd, "candidates");
            const originals = join(cwd, "originals");
            await mkdir(candidates, { recursive: true });
            await mkdir(originals);
            const a = join(candidates, "a.glb");
            const b = join(candidates, "b.glb");
            await writeFile(a, sourceBytes);
            await writeFile(b, sourceBytes);
            await writeFile(join(originals, "a.glb"), sourceBytes);
            const empty = await new NodeIO().readBinary(generateGlbData());
            for (const mesh of empty.getRoot().listMeshes()) mesh.dispose();
            await writeFile(join(originals, "b.glb"), await new NodeIO().writeBinary(empty));
            const result = await run(["inspect", a, b, a, "--against", originals, "--view", "64"]);
            expect(result.code, result.stdout).toBe(1);
            const rows = parse(result.stdout).models as { file: string; status: string; code?: string; fidelity?: number }[];
            const compared = rows.filter((row) => row.file.endsWith("/a.glb"));
            expect(compared).toHaveLength(2);
            for (const row of compared) {
                expect(row.status).toBe("ok");
                expect(row.fidelity).toBeGreaterThanOrEqual(0.999);
            }
            expect(rows.find((row) => row.file.endsWith("/b.glb"))).toMatchObject({ status: "failed", code: "INVALID_INPUT" });
        }, 60_000);
    });
});
