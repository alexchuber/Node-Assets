import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decode, out, progress, withDiagnostics } from "../../packages/cli/src/output";

describe("CLI library diagnostics", () => {
    let stdout: string;
    let stderr: string;
    let saved: Pick<typeof console, "log" | "info" | "warn" | "debug" | "error">;

    beforeEach(() => {
        saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug, error: console.error };
        stdout = "";
        stderr = "";
        vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
            stdout += String(chunk);
            return true;
        });
        vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
            stderr += String(chunk);
            return true;
        });
    });

    afterEach(() => {
        Object.assign(console, saved);
        vi.restoreAllMocks();
    });

    it("silences library consoles without hiding CLI output, progress, or errors", async () => {
        await withDiagnostics(async () => {
            console.log("library log");
            console.info("library info");
            console.warn("library warning");
            console.debug("library debug");
            console.error("library error");
            progress("run: input.glb");
            out({ error: "invalid input", code: "INVALID_INPUT" });
        });
        expect(stderr).toBe("run: input.glb\n");
        expect(decode(stdout)).toMatchObject({ code: "INVALID_INPUT" });
    });

    it("keeps overlapping and nested executions quiet until the last one finishes", async () => {
        const info = console.info;
        let releaseFirst!: () => void;
        let releaseSecond!: () => void;
        const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
        const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
        const first = withDiagnostics(async () => firstGate);
        const second = withDiagnostics(async () => secondGate);
        try {
            releaseFirst();
            await first;
            await withDiagnostics(async () => console.info("nested library output"));
            console.info("overlapping library output");
            expect(stdout).toBe("");
            expect(stderr).toBe("");
        } finally {
            releaseFirst();
            releaseSecond();
            await Promise.all([first, second]);
        }
        expect(console.info).toBe(info);
    });

    it("restores every console method after a rejected execution", async () => {
        const before = { log: console.log, info: console.info, warn: console.warn, debug: console.debug, error: console.error };
        const failure = new Error("failed execution");
        await expect(
            withDiagnostics(async () =>
                withDiagnostics(async () => {
                    console.error("library error");
                    throw failure;
                })
            )
        ).rejects.toBe(failure);
        expect(stderr).toBe("");
        for (const method of ["log", "info", "warn", "debug", "error"] as const) expect(console[method]).toBe(before[method]);
    });
});
