import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../packages/cli/src/cli";
import { commandHelp, manual } from "../../packages/cli/src/help";
import { decode, serialize } from "../../packages/cli/src/output";

describe("CLI command routing", () => {
    let stdout: string;

    beforeEach(() => {
        stdout = "";
        vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
            stdout += String(chunk);
            return true;
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it.each([["help"], ["--help"], ["-h"], ["--help", "--help"], ["-h", "-h"]])("prints the manual for %j", async (...argv) => {
        expect(await main(argv)).toBe(0);
        expect(stdout).toBe(manual());
    });

    it.each(["inspect", "run", "show", "tune", "help"])("prints command help for %s", async (command) => {
        expect(await main([command, "--help"])).toBe(0);
        expect(stdout).toBe(serialize(commandHelp(command as Parameters<typeof commandHelp>[0])));
    });

    it.each([["help", "extra"], ["--help", "extra"], ["-h", "extra"], ["show"], ["show", "optimize", "extra"], ["show", "--unknown"], ["help", "--unknown"]])(
        "returns a usage error for %j",
        async (...argv) => {
            expect(await main(argv)).toBe(2);
            expect(decode(stdout)).toMatchObject({ code: "USAGE" });
        }
    );

    it("lets show help take precedence over graph arguments", async () => {
        expect(await main(["show", "--help", "extra", "arguments"])).toBe(0);
        expect(stdout).toBe(serialize(commandHelp("show")));
    });

    it("shows the built-in graph with its output keys in order", async () => {
        expect(await main(["show", "optimize"])).toBe(0);
        const graph = decode(stdout) as Record<string, unknown>;
        expect(Object.keys(graph)).toEqual(["graph", "name", "blocks"]);
        expect(graph.graph).toBe(1);
        expect(graph.name).toBe("optimize");
    });
});
