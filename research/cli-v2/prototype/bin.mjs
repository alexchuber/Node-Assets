#!/usr/bin/env node
// Fast path: answer --version before any heavy module loads (AXI §10).
import { VERSION } from "./version.mjs";
const a = process.argv.slice(2);
if (a.length === 1 && ["-v", "-V", "--version"].includes(a[0])) {
    process.stdout.write(VERSION + "\n");
} else {
    const { main } = await import("./cli.mjs");
    process.exitCode = await main(a);
}
