// Compare the load model with the independent grader's quiet cold-load measurements on the trial outputs (L1).
import { readFileSync, existsSync } from "node:fs";
import { readDoc } from "../engine.mjs";
import { features, decodeMs } from "../loadmodel.mjs";
import { decoderBytes } from "../measure.mjs";
import { extensionsOf } from "../measure.mjs";
const S = process.argv[2];
const rows = [];
for (const id of process.argv.slice(3)) {
    const r = JSON.parse(readFileSync(`${S}/trials2/${id}/result.json`, "utf8"));
    const p = `${S}/trials2_outputs/${id}/work/public/models/toycar.glb`;
    if (!existsSync(p) || !r.grade._load_s) continue;
    const b = new Uint8Array(readFileSync(p));
    const doc = await readDoc(b);
    const net = ((b.length + decoderBytes(extensionsOf(doc).decoders)) * 8) / 9e6;
    rows.push({ id, measured: r.grade._load_s, model: +(net + decodeMs(features(doc, b.length)) / 1000).toFixed(3) });
}
rows.sort((a, b) => a.measured - b.measured);
for (const r of rows) console.log(r.id.padEnd(30), "measured", r.measured, "model", r.model);
const rk = (a) => a.map((x) => a.filter((y) => y < x).length);
const m = rk(rows.map((r) => r.measured)), e = rk(rows.map((r) => r.model));
const n = rows.length, mean = (a) => a.reduce((x, y) => x + y, 0) / n;
const cov = m.reduce((s, x, i) => s + (x - mean(m)) * (e[i] - mean(e)), 0), sd = (a) => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0));
console.log("n", n, "spearman", (cov / (sd(m) * sd(e))).toFixed(3), "mean abs diff", (rows.reduce((s, r) => s + Math.abs(r.measured - r.model), 0) / n).toFixed(3), "s");
