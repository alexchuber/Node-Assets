import { execFile } from "node:child_process";
import { cp, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

import cliPackage from "../../packages/cli/package.json";

export async function buildCliFixtureAsync(directory: string, renderer = false): Promise<string> {
    const cliDirectory = join(directory, ".cli");
    await mkdir(cliDirectory, { recursive: true });
    await cp(new URL("../../packages/cli/package.json", import.meta.url), join(cliDirectory, "package.json"));
    await cp(new URL("../../packages/cli/bin", import.meta.url), join(cliDirectory, "bin"), { recursive: true });
    await cp(new URL("../../packages/cli/graphs", import.meta.url), join(cliDirectory, "graphs"), { recursive: true });
    await symlink(fileURLToPath(new URL("../../packages/cli/node_modules", import.meta.url)), join(cliDirectory, "node_modules"), "dir");
    await build({
        configFile: fileURLToPath(new URL("../../packages/cli/vite.config.ts", import.meta.url)),
        logLevel: "silent",
        build: { outDir: join(cliDirectory, "dist") },
    });
    if (renderer) {
        await build({
            configFile: fileURLToPath(new URL("../../packages/cli/vite.render.config.ts", import.meta.url)),
            logLevel: "silent",
            build: { outDir: join(cliDirectory, "dist/render") },
        });
    }
    return join(cliDirectory, cliPackage.bin["node-assets"]);
}

interface CommandResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export function runNodeAsync(args: readonly string[], cwd: string, timeout = 60_000): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error?.code ?? 0;
            if (typeof code !== "number" || error?.killed) {
                reject(error);
                return;
            }
            resolve({ code, stdout, stderr });
        });
    });
}
