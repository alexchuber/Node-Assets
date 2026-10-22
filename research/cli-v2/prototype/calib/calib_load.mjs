// Calibration for a deterministic load model: build variants that vary one stage at a time, measure cold load
// (fresh browser context, median of 5) and record features. Run on a quiet machine.
// usage: node calib_load.mjs out.json assets/a.glb ...
import { writeFile } from "node:fs/promises";
import { loadBytes, applyRecipe, DEFAULT_RECIPE } from "../engine.mjs";
import { coldLoad, stopRenderer } from "../render.mjs";
import { features } from "../loadmodel.mjs";

const [outFile, ...inputs] = process.argv.slice(2);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mk = (tex, geo) => {
    const r = structuredClone(DEFAULT_RECIPE);
    Object.assign(r.stages.textures, tex);
    Object.assign(r.stages.geometry, geo);
    r.stages.cleanup.flatten = true;
    return r;
};
const tex = [
    { format: "keep", maxSize: 1024 }, { format: "webp", quality: 80, dataQuality: 80, maxSize: 1024 }, { format: "avif", quality: 60, dataQuality: 60, maxSize: 1024 }, { format: "ktx2", maxSize: 1024 },
    { format: "keep", maxSize: 256 }, { format: "webp", quality: 80, dataQuality: 80, maxSize: 256 }, { format: "avif", quality: 60, dataQuality: 60, maxSize: 256 }, { format: "ktx2", maxSize: 256 },
    { format: "png", maxSize: 512 }, { format: "jpeg", quality: 80, dataQuality: 80, maxSize: 2048 },
];
const geo = [{ mode: "quantize" }, { mode: "meshopt", meshoptLevel: "high" }, { mode: "draco" }, { mode: "none" }];
const rows = [];
for (const input of inputs) {
    const glb = await loadBytes(input);
    const variants = [...tex.map((t) => [t, { mode: "quantize" }]), ...geo.map((g) => [{ format: "webp", quality: 80, dataQuality: 80, maxSize: 256 }, g]), ...geo.slice(1, 3).map((g) => [{ format: "avif", quality: 60, dataQuality: 60, maxSize: 1024 }, g])];
    for (const [t, g] of variants) {
        const { bytes, doc } = await applyRecipe(glb, mk(t, g));
        const ms = [];
        for (let i = 0; i < 5; i++) ms.push(await coldLoad(bytes));
        rows.push({ input, tex: t.format, size: t.maxSize, geo: g.mode, ms: median(ms), spread: Math.max(...ms) - Math.min(...ms), ...features(doc, bytes.length) });
        process.stderr.write(`${input} ${t.format}@${t.maxSize} ${g.mode}: ${median(ms)} ms\n`);
    }
}
await stopRenderer();
await writeFile(outFile, JSON.stringify(rows, null, 1));
