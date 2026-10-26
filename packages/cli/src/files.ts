import { randomUUID } from "node:crypto";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CliError } from "./output";

export async function writeAtomicAsync(file: string, bytes: Uint8Array | string, replace = true): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const scratch = join(dirname(file), `.${randomUUID()}.tmp`);
    try {
        await writeFile(scratch, bytes, { flag: "wx" });
        if (replace) await rename(scratch, file);
        else await link(scratch, file);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new CliError("OUTPUT_EXISTS", `${file} already exists`, ["add --force to replace it, or choose another -o"]);
        }
        throw error;
    } finally {
        await rm(scratch, { force: true });
    }
}
