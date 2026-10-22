// Logs every CLI invocation for a trial, then runs bin.mjs with the trial's variant settings.
import { spawn } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const trial = process.env.NA_TRIAL;
const v = JSON.parse(readFileSync(path.join(trial, "variant.json"), "utf8"));
const args = process.argv.slice(2), t0 = Date.now();
const log = (r) => appendFileSync(path.join(trial, "calls.jsonl"), JSON.stringify(r) + "\n");
log({ ev: "start", t: t0, cwd: process.cwd(), args });
const env = { ...process.env, NA_TUNE: v.tune ? "1" : "0", NA_FORMAT: v.format ?? "toon" };
delete env.NA_TRIAL;
const child = spawn(process.execPath, [path.join(here, "bin.mjs"), ...args], { env, stdio: ["inherit", "pipe", "pipe"] });
let out = "", err = "";
child.stdout.on("data", (d) => { process.stdout.write(d); out += d; });
child.stderr.on("data", (d) => { process.stderr.write(d); err += d; });
child.on("close", (code, signal) => { log({ ev: "end", t: t0, ms: Date.now() - t0, cwd: process.cwd(), args, code, signal, stdout: out.slice(0, 20000), stderr: err.slice(0, 4000), outLen: out.length, errLen: err.length }); process.exit(code ?? 1); });
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => child.kill(sig));
