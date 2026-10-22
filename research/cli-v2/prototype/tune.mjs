// Goal-driven, anytime search over the levers, under a fidelity limit.
// Work is done in rounds, most promising settings first. After every round each goal has a verified result, so a run
// cut short by the time limit still returns good recipes. Texture and geometry stages are searched separately (their
// bytes add up), then the best predicted combinations are built and scored.
import { applyRecipe, readDoc, DEFAULT_RECIPE } from "./engine.mjs";
import { gpuEstimate, extensionsOf, decoderBytes, NETWORKS, docSummary } from "./measure.mjs";
import { setReference, evaluate as score } from "./render.mjs";
import { features, decodeMs } from "./loadmodel.mjs";

export const GOALS = ["size", "gpu", "load", "compat"];
const clone = (x) => structuredClone(x);
const log = (s) => process.stderr.write(`tune: ${s}\n`);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
// NA_ORACLE=1: a finer grid, used only to compute reference results for grading the agent trials.
const ORACLE = !!process.env.NA_ORACLE;
const LEVELS = ORACLE ? [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] : [30, 40, 50, 60, 70, 80, 90]; // texture quality steps; searches start at 90

function recipeWith(base, patch) {
    const r = clone(base);
    for (const [stage, v] of Object.entries(patch)) r.stages[stage] = { ...r.stages[stage], ...v, ...(v.ktx2 ? { ktx2: { ...r.stages[stage].ktx2, ...v.ktx2 } } : {}) };
    return r;
}

const TEXFAM = {
    avif: { format: "avif", q: true },
    webp: { format: "webp", q: true },
    jpeg: { format: "jpeg", q: true },
    png: { format: "png" },
    "ktx2 etc1s+uastc": { format: "ktx2", ktx2: { color: "etc1s", data: "uastc" } },
    "ktx2 uastc": { format: "ktx2", ktx2: { color: "uastc", data: "uastc" } },
    "ktx2 etc1s": { format: "ktx2", ktx2: { color: "etc1s", data: "etc1s" } },
};
const GEOM = {
    quantize: { mode: "quantize" },
    meshopt: { mode: "meshopt", meshoptLevel: "medium" },
    "meshopt-high": { mode: "meshopt", meshoptLevel: "high" },
    draco: { mode: "draco", dracoPosition: 14, dracoNormal: 10, dracoTexcoord: 12 },
    "draco-low": { mode: "draco", dracoPosition: 11, dracoNormal: 8, dracoTexcoord: 10 },
    none: { mode: "none" },
    "draco-12": { mode: "draco", dracoPosition: 12, dracoNormal: 8, dracoTexcoord: 10 },
    "draco-10": { mode: "draco", dracoPosition: 10, dracoNormal: 7, dracoTexcoord: 9 },
};

// Priority per goal: [round 1, later rounds]. Prior knowledge only decides the ORDER; the fidelity limit and the
// measured metric decide the winner.
const PLAN = {
    size: { tex: [["avif"], ["webp"]], geo: [["draco", "meshopt-high"], ["draco-low"]] },
    load: { tex: [["avif"], ["webp"]], geo: [["meshopt-high", "draco"], ["meshopt"]] },
    gpu: { tex: [["ktx2 etc1s+uastc"], ["ktx2 uastc", "ktx2 etc1s"]], geo: [["meshopt"], []] },
    compat: { tex: [["jpeg"], ["png"]], geo: [["none"], []] },
};
if (ORACLE) {
    PLAN.size.geo[1].push("draco-12", "draco-10", "meshopt");
    PLAN.load.geo[1].push("draco-low", "draco-12", "quantize");
    PLAN.gpu.geo[1].push("quantize");
    PLAN.load.tex[1].push("ktx2 etc1s");
}
const TEXEXT = new Set(["EXT_texture_webp", "EXT_texture_avif", "KHR_texture_basisu"]);
const GEOEXT = new Set(["KHR_mesh_quantization", "EXT_meshopt_compression", "KHR_draco_mesh_compression"]);

export async function tune(glb, opts) {
    const { goals, floor, view, views, network, amortize, timeLimitMs, keep } = opts;
    const t0 = Date.now();
    const timeUp = () => Date.now() - t0 > timeLimitMs;
    const mbps = NETWORKS[network];
    const netS = (b) => (b * 8) / (mbps * 1e6);
    const amort = (names) => decoderBytes(names) / amortize;
    const original = await readDoc(glb);
    const summary = docSummary(original);
    const ref = await setReference(glb, { size: view, views });
    const out = { candidates: [], winners: {}, stoppedEarly: false, skipped: [], frame: ref.frame };
    const skip = (what) => {
        out.stoppedEarly = true;
        if (!out.skipped.includes(what)) out.skipped.push(what);
    };

    const compatOnly = goals.length === 1 && goals[0] === "compat";
    const base = recipeWith(DEFAULT_RECIPE, {
        cleanup: { prune: true, dedup: true, weld: true, metalRough: true, flatten: summary.animations === 0 && !keep.has("hierarchy"), instance: !keep.has("hierarchy") && !compatOnly, palette: false },
        textures: { format: "keep", maxSize: Math.max(summary.maxTexture, 16) },
        geometry: { mode: compatOnly ? "none" : "quantize", simplify: 1 },
    });

    const seen = new Map();
    const evaluate = async (label, recipe) => {
        const key = JSON.stringify(recipe.stages);
        if (seen.has(key)) return seen.get(key);
        const { bytes, doc } = await applyRecipe(glb, recipe);
        const f = await score(bytes);
        const ex = extensionsOf(doc);
        const gpu = gpuEstimate(doc);
        const c = { label, recipe, glb: bytes, bytes: bytes.length, gpu: gpu.total, gpuTex: gpu.textures, gpuGeo: gpu.geometry, decoders: ex.decoders, required: ex.required, fidelity: f.worst, worstView: f.worstView, decodeMs: decodeMs(features(doc, bytes.length)) };
        c.pass = c.fidelity >= floor;
        seen.set(key, c);
        out.candidates.push(c);
        log(`${label}: ${(c.bytes / 1e6).toFixed(3)} MB, GPU ${(c.gpu / 1048576).toFixed(1)} MiB, fidelity ${c.fidelity.toFixed(3)}${c.pass ? "" : " (below limit)"}`);
        return c;
    };
    const baseline = await evaluate("baseline (cleanup only)", base);

    // ---- texture stage (scored with baseline geometry) ----
    const texPool = [baseline]; // every passing texture candidate; the combination step picks from these
    const fams = {}; // family name -> { best, sizeIdx }
    const sizes = summary.maxTexture <= 0 ? [] : keep.has("texture-size") ? [summary.maxTexture] : (ORACLE ? [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096] : [256, 512, 768, 1024, 1536, 2048, 3072, 4096]).filter((s) => s < summary.maxTexture).concat([summary.maxTexture]);
    const texCfg = (fam, size, cq = 90, dq = 90) => {
        const { q, ...cfg } = TEXFAM[fam];
        return { ...cfg, ...(q ? { quality: cq, dataQuality: dq } : {}), maxSize: sizes[size] };
    };
    const texEval = async (fam, size, cq = 90, dq = 90) => {
        const c = await evaluate(`textures ${fam} ${sizes[size]}px${TEXFAM[fam].q ? ` q${cq}/${dq}` : ""}`, recipeWith(base, { textures: texCfg(fam, size, cq, dq) }));
        if (c.pass && !texPool.includes(c)) texPool.push(c);
        return c;
    };
    // smallest texture size that stays within the limit (at quality 90); maxIdx caps the sizes tried
    // smallest texture size that stays within the limit (at quality 90). Quality formats start at the top size, so a
    // usable result exists early (and if the top size fails, smaller ones will too); maxIdx caps the sizes tried.
    const sizeTop = async (fam, maxIdx = sizes.length - 1) => {
        if (fams[fam] || !sizes.length) return;
        if (!(TEXFAM[fam].q || maxIdx < sizes.length - 1)) return void (fams[fam] = { best: null, lo: 0, hi: maxIdx, open: true });
        if (timeUp()) return skip(`${fam} textures`);
        const pass = (await texEval(fam, maxIdx)).pass;
        fams[fam] = { best: pass ? maxIdx : null, lo: 0, hi: maxIdx - 1, open: pass };
    };
    const sizeSearch = async (fam, maxIdx) => {
        await sizeTop(fam, maxIdx);
        const f = fams[fam];
        if (!f?.open) return;
        while (f.lo <= f.hi) {
            if (timeUp()) return void skip(`${fam} texture sizes`);
            const mid = (f.lo + f.hi) >> 1;
            if ((await texEval(fam, mid)).pass) (f.best = mid), (f.hi = mid - 1);
            else f.lo = mid + 1;
        }
        f.open = false;
    };
    // lowest passing level in levels[] for a monotone test; returns undefined if none pass
    const lowest = async (levels, test, what) => {
        let lo = 0, hi = levels.length - 1, best;
        while (lo <= hi) {
            if (timeUp()) return skip(what), best;
            const mid = (lo + hi) >> 1;
            if (await test(levels[mid])) (best = levels[mid]), (hi = mid - 1);
            else lo = mid + 1;
        }
        return best;
    };
    // quality descent at the family's size: both maps together, then color maps alone, then data maps alone
    const qualitySearch = async (fam) => {
        const f = fams[fam];
        if (!f || f.best == null || !TEXFAM[fam].q || f.q) return;
        const s = f.best, what = `${fam} quality`;
        const q = (await lowest(LEVELS.filter((l) => l < 90), async (l) => (await texEval(fam, s, l, l)).pass, what)) ?? 90;
        const cq = (await lowest(LEVELS.filter((l) => l < q), async (l) => (await texEval(fam, s, l, q)).pass, what)) ?? q;
        const dq = (await lowest(LEVELS.filter((l) => l < q), async (l) => (await texEval(fam, s, cq, l)).pass, what)) ?? q;
        f.q = [cq, dq];
    };

    // ---- geometry stage (scored with original textures) ----
    const geoPool = [baseline];
    const geoEval = async (id, simplify = 1) => {
        if (id === "quantize" && simplify === 1 && !compatOnly) return baseline;
        const c = await evaluate(`geometry ${id}${simplify < 1 ? ` simplify ${simplify}` : ""}`, recipeWith(base, { geometry: { ...GEOM[id], simplify } }));
        if (c.pass && !geoPool.includes(c)) geoPool.push(c);
        return c;
    };
    const canSimplify = !keep.has("geometry") && summary.triangles > 2000;
    let simplifyRatio; // most simplification that stays within the limit (searched once, on the baseline geometry)
    const simplifySearch = async () => {
        if (!canSimplify || simplifyRatio !== undefined) return;
        const id = compatOnly ? "none" : "quantize";
        simplifyRatio = (await lowest(ORACLE ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] : [0.25, 0.5, 0.75], async (r) => (await geoEval(id, r)).pass, "simplification")) ?? null;
    };

    // ---- combinations: predicted from stage results, then built and scored ----
    const comboOf = (t, g) => {
        const bytes = t.bytes + g.bytes - baseline.bytes;
        const decoders = [...new Set([...t.decoders.filter((d) => d === "ktx2"), ...g.decoders.filter((d) => d !== "ktx2")])];
        const required = [...new Set([...t.required.filter((e) => TEXEXT.has(e)), ...g.required.filter((e) => GEOEXT.has(e)), ...baseline.required.filter((e) => !TEXEXT.has(e) && !GEOEXT.has(e))])];
        const dms = Math.max(0, t.decodeMs + g.decodeMs - baseline.decodeMs); // the model is linear, so stage costs add up
        const recipe = recipeWith(t.recipe, { geometry: g.recipe.stages.geometry });
        return { t, g, recipe, bytes, decoders, required, gpu: t.gpuTex + g.gpuGeo, loadS: netS(bytes + amort(decoders)) + dms / 1000 };
    };
    const isCompat = (r, decoders) => !decoders.length && !["ktx2", "webp", "avif"].includes(r.stages.textures.format) && r.stages.geometry.mode === "none";
    const metric = {
        size: (c) => c.bytes + amort(c.decoders),
        gpu: (c) => c.gpu,
        load: (c) => (c.loadS !== undefined ? c.loadS : netS(c.bytes + amort(c.decoders)) + c.decodeMs / 1000),
        compat: (c) => c.required.length * 1e12 + c.bytes,
    };
    const eligible = (goal, c) => goal !== "compat" || isCompat(c.recipe, c.decoders);
    const bestOf = (goal) => {
        const pool = out.candidates.filter((c) => c.pass && eligible(goal, c));
        pool.sort((a, b) => metric[goal](a) - metric[goal](b));
        return pool[0];
    };
    const failedCombos = []; // a combination that fails rules out any with lossier textures AND lossier geometry
    const lossier = (a, b) => a === b || a.fidelity < b.fidelity;
    const doomed = (c) => failedCombos.some((f) => lossier(c.t, f.t) && lossier(c.g, f.g));
    const combine = async (round) => {
        for (const goal of goals) {
            const ranked = texPool.flatMap((t) => geoPool.map((g) => comboOf(t, g))).filter((c) => eligible(goal, c)).sort((a, b) => metric[goal](a) - metric[goal](b));
            let built = 0;
            for (const c of ranked) {
                const cur = bestOf(goal);
                if (cur && metric[goal](c) >= metric[goal](cur) * 0.995) break; // cannot beat what is already verified
                if (built >= (ORACLE ? 8 : 4)) break;
                // out of time: still build one combination per goal if it promises a big gain (>10%)
                if (timeUp() && cur && (built >= 1 || metric[goal](c) >= metric[goal](cur) * 0.9)) {
                    skip("combining texture and geometry settings");
                    break;
                }
                const recipe = c.recipe;
                const key = JSON.stringify(recipe.stages);
                if (seen.has(key) || doomed(c)) continue;
                built++;
                const tl = c.t === baseline ? "original textures" : c.t.label.replace("textures ", "");
                const gl = c.g === baseline ? base.stages.geometry.mode : c.g.label.replace("geometry ", "");
                if ((await evaluate(`${goal}: ${tl} + ${gl}`, recipe)).pass) break;
                failedCombos.push(c);
            }
        }
    };

    const plan = (goal) => PLAN[goal];
    // Round 1: the most promising geometry modes (cheap to score) and texture format for each goal
    for (const goal of goals) for (const id of plan(goal).geo[0]) if (!timeUp()) await geoEval(id);
    else skip(`geometry ${id}`);
    for (const goal of goals) for (const fam of plan(goal).tex[0]) await sizeTop(fam);
    await combine(1);
    for (const goal of goals) for (const fam of plan(goal).tex[0]) await sizeSearch(fam);
    await combine(1);
    // Round 2: texture quality per map type, lossier geometry, simplification
    for (const goal of goals) for (const fam of plan(goal).tex[0]) await qualitySearch(fam);
    for (const goal of goals) for (const id of plan(goal).geo[1]) if (!timeUp()) await geoEval(id);
    else skip(`geometry ${id}`);
    if (!timeUp()) await simplifySearch();
    else if (canSimplify) skip("simplification");
    if (simplifyRatio) for (const goal of goals) for (const id of plan(goal).geo[0]) if (!timeUp()) await geoEval(id, simplifyRatio);
    await combine(2);
    // Round 3: the other texture formats
    for (const goal of goals) {
        for (const fam of plan(goal).tex[1]) {
            if (timeUp()) {
                skip(`${fam} textures`);
                continue;
            }
            if (goal === "gpu" && fams["ktx2 etc1s+uastc"]?.best != null) {
                // for GPU memory only a smaller size helps: try UASTC below the current size, ETC1S at it (smaller file)
                const cur = fams["ktx2 etc1s+uastc"].best;
                if (fam === "ktx2 uastc" && cur > 0) await sizeSearch(fam, cur - 1);
                if (fam === "ktx2 etc1s") fams[fam] ??= { best: (await texEval(fam, cur)).pass ? cur : null };
            } else {
                await sizeSearch(fam);
                await qualitySearch(fam);
            }
        }
    }
    await combine(3);

    for (const goal of goals) {
        let pool = out.candidates.filter((c) => c.pass && eligible(goal, c));
        // goal metric first (within 1% counts as a tie), then fidelity (to 0.01), then size
        pool.sort((a, b) => metric[goal](a) - metric[goal](b));
        const bestGoal = pool.length ? metric[goal](pool[0]) : 0;
        const ties = pool.filter((c) => metric[goal](c) <= bestGoal * 1.01 + 1e-9);
        ties.sort((a, b) => Math.round(b.fidelity * 100) - Math.round(a.fidelity * 100) || a.bytes - b.bytes);
        out.winners[goal] = ties[0] ?? baseline;
    }
    out.original = { bytes: glb.length, gpu: gpuEstimate(original).total, loadS: netS(glb.length) + decodeMs(features(original, glb.length)) / 1000, summary };
    out.loadS = (c) => metric.load(c);
    out.elapsedMs = Date.now() - t0;
    return out;
}
