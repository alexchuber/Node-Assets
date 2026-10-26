import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommandAsync } from "../../packages/cli/src/commands/run";
import { serialize } from "../../packages/cli/src/output";
import { generateGlbData } from "../helpers/gltf";

vi.mock(import("node:path"), async (importOriginal) => ({
    ...(await importOriginal()),
    sep: "\\" as const,
}));

describe("CLI run output directories", () => {
    let directory: string;
    let input: string;
    let graph: string;
    const bytes = generateGlbData();

    beforeAll(async () => {
        directory = resolve(`_cli-run-${randomUUID()}`);
        await mkdir(directory);
        input = join(directory, "input.glb");
        graph = join(directory, "graph.toon");
        await writeFile(input, bytes);
        await writeFile(graph, serialize({ graph: 1, blocks: [{ type: "transform.dedup" }] }));
    });

    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    beforeEach(() => {
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    });

    afterEach(() => vi.restoreAllMocks());

    it.each([
        ["forward", "/"],
        ["native", sep],
    ])("creates a new output directory with a trailing %s separator", async (name, separator) => {
        const output = join(directory, name) + separator;
        await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(runCommandAsync([graph, input, "-o", output])).resolves.toBe(0);
        expect((await stat(output)).isDirectory()).toBe(true);
        expect((await stat(join(output, "input.glb"))).size).toBeGreaterThan(0);
        expect(await readFile(input)).toEqual(Buffer.from(bytes));
    });
});
