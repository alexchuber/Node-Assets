import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decode } from "../../packages/cli/src/output";
import { buildCliFixtureAsync, runNodeAsync } from "../helpers/cli";

describe("tune flags through the CLI", () => {
    let directory: string;
    let launcher: string;
    beforeAll(async () => {
        directory = resolve(`_tune-options-${randomUUID()}`);
        await mkdir(directory);
        launcher = await buildCliFixtureAsync(directory);
    }, 120_000);
    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it.each(
        [
            [],
            ["missing.glb"],
            ["--for", "size"],
            ["missing.glb", "--for", "speed"],
            ["missing.glb", "--for", "size,"],
            ["missing.glb", "--for", "size", "--unknown"],
            ...["0", "-1", "1.1", "NaN", "Infinity", ""].map((value) => ["missing.glb", "--for", "size", "--fidelity", value]),
            ...["63", "4097", "128.5", "128junk", "NaN"].map((value) => ["missing.glb", "--for", "size", "--view", value]),
            ["missing.glb", "--for", "size", "--network", "fast"],
            ...["0", "-1", "1.5", "NaN", "2junk"].map((value) => ["missing.glb", "--for", "size", "--amortize", value]),
            ...["materials", "hierarchy,invalid", ""].map((value) => ["missing.glb", "--for", "size", "--keep", value]),
            ...["0s", "-1m", "5ms", "forever", "Infinity", "1e3s", ""].map((value) => ["missing.glb", "--for", "size", "--time-limit", value]),
            ["missing.glb", "--for", "size,gpu", "-o", "result.toon"],
            ["one.glb", "two.glb", "--for", "size", "-o", "result.toon"],
        ].map((args) => [args])
    )("rejects invalid flags without doing work %#", async (args) => {
        const result = await runNodeAsync([launcher, "tune", ...args], directory);
        expect(result.code, result.stdout).toBe(2);
        expect(decode(result.stdout)).toMatchObject({ code: "USAGE" });
        expect(await readdir(directory)).toEqual([".cli"]);
    });

    it.each(["90s", "5m", "1h", "1min", "2.5s", "90", " 1 m "])("accepts duration %s before handling input errors", async (duration) => {
        const result = await runNodeAsync(
            [
                launcher,
                "tune",
                "missing.glb",
                "--for",
                "size",
                "--fidelity",
                "1",
                "--view",
                "64",
                "--amortize",
                "2",
                "--keep",
                "hierarchy,texture-size,geometry",
                "--network",
                "wifi",
                "--time-limit",
                duration,
            ],
            directory
        );
        expect(result.code, result.stdout).toBe(1);
        expect(decode(result.stdout)).toMatchObject({ results: [], failed: [{ code: "INPUT_NOT_FOUND" }] });
    });
});
