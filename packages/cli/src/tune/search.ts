import { readDocAsync } from "../document";
import { decodeMs, features } from "../loadModel";
import { decoderBytes, docSummary, extensionsOf, gpuEstimate, loadSeconds, NETWORKS, type Network } from "../measure";
import { CliError, progress } from "../output";
import type { FidelityRenderer } from "../render";
import type { createTuneExecutor } from "./cache";
import { GEOEXT, GEOM, LEVELS, PLAN, SIMPLIFY_LEVELS, SIZES, TEXEXT, TEXFAM, type Goal } from "./plan";
import { initialStages, withStages, type StagePatch, type TuneStages } from "./stages";

interface Ranked {
    readonly stages: TuneStages;
    readonly bytes: number;
    readonly decoders: string[];
    readonly required: string[];
    readonly gpu: number;
    readonly decodeMs: number;
}

export interface TuneCandidate extends Ranked {
    readonly label: string;
    readonly glb: Uint8Array;
    readonly gpuTex: number;
    readonly gpuGeo: number;
    readonly fidelity: number;
    readonly worstView: number;
    readonly pass: boolean;
    readonly loadS: number;
}

interface Combination extends Ranked {
    readonly t: TuneCandidate;
    readonly g: TuneCandidate;
}

interface FamilySearch {
    best: number | null;
    lo: number;
    hi: number;
    open: boolean;
    q?: [number, number];
}

interface TuneOptions {
    readonly goals: readonly Goal[];
    readonly floor: number;
    readonly view: number;
    readonly network: Network;
    readonly amortize: number;
    readonly deadline: number;
    readonly keep: ReadonlySet<string>;
    readonly renderer: FidelityRenderer;
    readonly executor: ReturnType<typeof createTuneExecutor>;
}

export async function tuneAsync(glb: Uint8Array, hash: string, opts: TuneOptions) {
    const { goals, floor, view, network, amortize, deadline, keep, renderer, executor } = opts;
    const t0 = Date.now();
    const timeUp = () => Date.now() >= deadline;
    const netS = (bytes: number) => (bytes * 8) / (NETWORKS[network] * 1e6);
    const amort = (names: readonly string[]) => decoderBytes(names) / amortize;
    const original = await readDocAsync(glb);
    const summary = docSummary(original);
    await renderer.setReferenceAsync(glb, { size: view, views: 4 });
    const candidates: TuneCandidate[] = [];
    const skipped: string[] = [];
    const skip = (what: string) => {
        if (!skipped.includes(what)) skipped.push(what);
    };
    const compatOnly = goals.length === 1 && goals[0] === "compat";
    const base = initialStages(summary, keep, compatOnly);
    const eligible = (goal: Goal, c: Ranked) =>
        goal !== "compat" ||
        (!c.decoders.length &&
            !["ktx2", "webp", "avif"].includes(c.stages.textures.format) &&
            c.stages.geometry.mode === "none" &&
            !c.required.some((extension) => TEXEXT.includes(extension) || GEOEXT.includes(extension)));
    const seen = new Map<string, TuneCandidate>();
    const evaluateAsync = async (label: string, stages: TuneStages): Promise<TuneCandidate> => {
        const key = JSON.stringify(stages);
        const previous = seen.get(key);
        if (previous) return previous;
        const bytes = await executor.executeAsync(hash, glb, stages, summary.maxTexture);
        const doc = await readDocAsync(bytes);
        const fidelity = await renderer.evaluateAsync(bytes);
        const ex = extensionsOf(doc);
        const gpu = gpuEstimate(doc);
        const c: TuneCandidate = {
            label,
            stages,
            glb: bytes,
            bytes: bytes.length,
            gpu: gpu.total,
            gpuTex: gpu.textures,
            gpuGeo: gpu.geometry,
            decoders: ex.decoders,
            required: ex.required,
            fidelity: fidelity.worst,
            worstView: fidelity.worstView,
            decodeMs: decodeMs(features(doc, bytes.length)),
            loadS: loadSeconds(doc, bytes.length, network, amortize),
            pass: fidelity.worst >= floor,
        };
        seen.set(key, c);
        candidates.push(c);
        progress(`tune: ${label}: ${(c.bytes / 1e6).toFixed(3)} MB, GPU ${(c.gpu / 1048576).toFixed(1)} MiB, fidelity ${c.fidelity.toFixed(3)}${c.pass ? "" : " (below limit)"}`);
        return c;
    };
    const baseline = await evaluateAsync("baseline (cleanup only)", base);
    if (timeUp()) skip("remaining search");
    const texPool = [baseline];
    if (compatOnly && !eligible("compat", baseline)) {
        const fallback = await evaluateAsync("compat fallback (original-size PNG)", withStages(base, { textures: { format: "png" } }));
        if (fallback.pass && eligible("compat", fallback)) texPool.push(fallback);
    }
    const fams: Record<string, FamilySearch> = {};
    const sizes = summary.maxTexture <= 0 ? [] : keep.has("texture-size") ? [summary.maxTexture] : SIZES.filter((size) => size < summary.maxTexture).concat([summary.maxTexture]);
    const texEvalAsync = async (fam: string, size: number, cq = 90, dq = 90) => {
        const { q, ...cfg } = TEXFAM[fam]!;
        const textures: StagePatch["textures"] = { ...cfg, ...(q ? { quality: cq, dataQuality: dq } : {}), maxSize: sizes[size]! };
        const c = await evaluateAsync(`textures ${fam} ${sizes[size]}px${q ? ` q${cq}/${dq}` : ""}`, withStages(base, { textures }));
        if (c.pass && !texPool.includes(c)) texPool.push(c);
        return c;
    };
    const sizeTopAsync = async (fam: string, maxIdx = sizes.length - 1) => {
        if (fams[fam] || !sizes.length) return;
        if (!(TEXFAM[fam]!.q || maxIdx < sizes.length - 1)) {
            fams[fam] = { best: null, lo: 0, hi: maxIdx, open: true };
            return;
        }
        if (timeUp()) return skip(`${fam} textures`);
        const pass = (await texEvalAsync(fam, maxIdx)).pass;
        fams[fam] = { best: pass ? maxIdx : null, lo: 0, hi: maxIdx - 1, open: pass };
    };
    const sizeSearchAsync = async (fam: string, maxIdx?: number) => {
        await sizeTopAsync(fam, maxIdx);
        const f = fams[fam];
        if (!f?.open) return;
        while (f.lo <= f.hi) {
            if (timeUp()) return skip(`${fam} texture sizes`);
            const mid = (f.lo + f.hi) >> 1;
            if ((await texEvalAsync(fam, mid)).pass) {
                f.best = mid;
                f.hi = mid - 1;
            } else f.lo = mid + 1;
        }
        f.open = false;
    };
    const lowestAsync = async (levels: readonly number[], testAsync: (level: number) => Promise<boolean>, what: string): Promise<number | undefined> => {
        let lo = 0;
        let hi = levels.length - 1;
        let best: number | undefined;
        while (lo <= hi) {
            if (timeUp()) {
                skip(what);
                return best;
            }
            const mid = (lo + hi) >> 1;
            if (await testAsync(levels[mid]!)) {
                best = levels[mid]!;
                hi = mid - 1;
            } else lo = mid + 1;
        }
        return best;
    };
    const qualitySearchAsync = async (fam: string) => {
        const f = fams[fam];
        if (!f || f.best === null || !TEXFAM[fam]!.q || f.q) return;
        const size = f.best;
        const what = `${fam} quality`;
        const q =
            (await lowestAsync(
                LEVELS.filter((level) => level < 90),
                async (level) => (await texEvalAsync(fam, size, level, level)).pass,
                what
            )) ?? 90;
        const cq =
            (await lowestAsync(
                LEVELS.filter((level) => level < q),
                async (level) => (await texEvalAsync(fam, size, level, q)).pass,
                what
            )) ?? q;
        const dq =
            (await lowestAsync(
                LEVELS.filter((level) => level < q),
                async (level) => (await texEvalAsync(fam, size, cq, level)).pass,
                what
            )) ?? q;
        f.q = [cq, dq];
    };

    const geoPool = [baseline];
    const geoEvalAsync = async (id: string, simplify = 1) => {
        if (id === "quantize" && simplify === 1 && !compatOnly) return baseline;
        const c = await evaluateAsync(`geometry ${id}${simplify < 1 ? ` simplify ${simplify}` : ""}`, withStages(base, { geometry: { ...GEOM[id], simplify } }));
        if (c.pass && !geoPool.includes(c)) geoPool.push(c);
        return c;
    };
    const canSimplify = !keep.has("geometry") && summary.triangles > 2000;
    let simplifyRatio: number | null | undefined;
    const simplifySearchAsync = async () => {
        if (!canSimplify || simplifyRatio !== undefined) return;
        simplifyRatio = (await lowestAsync(SIMPLIFY_LEVELS, async (ratio) => (await geoEvalAsync(compatOnly ? "none" : "quantize", ratio)).pass, "simplification")) ?? null;
    };

    const comboOf = (t: TuneCandidate, g: TuneCandidate): Combination => ({
        t,
        g,
        stages: withStages(t.stages, { geometry: g.stages.geometry }),
        bytes: t.bytes + g.bytes - baseline.bytes,
        decoders: [...new Set([...t.decoders.filter((decoder) => decoder === "ktx2"), ...g.decoders.filter((decoder) => decoder !== "ktx2")])],
        required: [
            ...new Set([
                ...t.required.filter((extension) => TEXEXT.includes(extension)),
                ...g.required.filter((extension) => GEOEXT.includes(extension)),
                ...baseline.required.filter((extension) => !TEXEXT.includes(extension) && !GEOEXT.includes(extension)),
            ]),
        ],
        gpu: t.gpuTex + g.gpuGeo,
        decodeMs: Math.max(0, t.decodeMs + g.decodeMs - baseline.decodeMs),
    });
    const metric: Record<Goal, (candidate: Ranked) => number> = {
        size: (c) => c.bytes + amort(c.decoders),
        gpu: (c) => c.gpu,
        load: (c) => netS(c.bytes + amort(c.decoders)) + c.decodeMs / 1000,
        compat: (c) => c.required.length * 1e12 + c.bytes,
    };
    const bestOf = (goal: Goal) => candidates.filter((c) => c.pass && eligible(goal, c)).sort((a, b) => metric[goal](a) - metric[goal](b))[0];
    const failedCombos: Combination[] = [];
    const lossier = (a: TuneCandidate, b: TuneCandidate) => a === b || a.fidelity < b.fidelity;
    const doomed = (c: Combination) => failedCombos.some((failed) => lossier(c.t, failed.t) && lossier(c.g, failed.g));
    const combineAsync = async () => {
        for (const goal of goals) {
            const ranked = texPool
                .flatMap((t) => geoPool.map((g) => comboOf(t, g)))
                .filter((c) => eligible(goal, c))
                .sort((a, b) => metric[goal](a) - metric[goal](b));
            let built = 0;
            for (const c of ranked) {
                const current = bestOf(goal);
                if (current && metric[goal](c) >= metric[goal](current) * 0.995) break;
                if (built >= 4) break;
                if (timeUp()) {
                    skip("combining texture and geometry settings");
                    break;
                }
                if (seen.has(JSON.stringify(c.stages)) || doomed(c)) continue;
                built++;
                const tl = c.t === baseline ? "original textures" : c.t.label.replace("textures ", "");
                const gl = c.g === baseline ? base.geometry.mode : c.g.label.replace("geometry ", "");
                if ((await evaluateAsync(`${goal}: ${tl} + ${gl}`, c.stages)).pass) break;
                failedCombos.push(c);
            }
        }
    };

    for (const goal of goals)
        for (const id of PLAN[goal].geo[0]) {
            if (!timeUp()) await geoEvalAsync(id);
            else skip(`geometry ${id}`);
        }
    for (const goal of goals) for (const fam of PLAN[goal].tex[0]) await sizeTopAsync(fam);
    await combineAsync();
    for (const goal of goals) for (const fam of PLAN[goal].tex[0]) await sizeSearchAsync(fam);
    await combineAsync();

    for (const goal of goals) for (const fam of PLAN[goal].tex[0]) await qualitySearchAsync(fam);
    for (const goal of goals)
        for (const id of PLAN[goal].geo[1]) {
            if (!timeUp()) await geoEvalAsync(id);
            else skip(`geometry ${id}`);
        }
    if (!timeUp()) await simplifySearchAsync();
    else if (canSimplify) skip("simplification");
    if (simplifyRatio)
        for (const goal of goals)
            for (const id of PLAN[goal].geo[0]) {
                if (!timeUp()) await geoEvalAsync(id, simplifyRatio);
                else skip(`geometry ${id} simplify ${simplifyRatio}`);
            }
    await combineAsync();

    for (const goal of goals) {
        for (const fam of PLAN[goal].tex[1]) {
            if (timeUp()) {
                skip(`${fam} textures`);
                continue;
            }
            const mixed = fams["ktx2 etc1s+uastc"];
            if (goal === "gpu" && mixed?.best != null) {
                const current = mixed.best;
                if (fam === "ktx2 uastc" && current > 0) await sizeSearchAsync(fam, current - 1);
                if (fam === "ktx2 etc1s") fams[fam] ??= { best: (await texEvalAsync(fam, current)).pass ? current : null, lo: 0, hi: -1, open: false };
            } else {
                await sizeSearchAsync(fam);
                await qualitySearchAsync(fam);
            }
        }
    }
    await combineAsync();

    const winners: Partial<Record<Goal, TuneCandidate>> = {};
    for (const goal of goals) {
        const pool = candidates.filter((c) => c.pass && eligible(goal, c)).sort((a, b) => metric[goal](a) - metric[goal](b));
        if (!pool.length) throw new CliError("INVALID_INPUT", `No ${goal} result met the fidelity limit`, ["Try a longer --time-limit or a lower --fidelity"]);
        const best = metric[goal](pool[0]!);
        const ties = pool.filter((c) => metric[goal](c) <= best * 1.01 + 1e-9);
        ties.sort((a, b) => Math.round(b.fidelity * 100) - Math.round(a.fidelity * 100) || a.bytes - b.bytes);
        winners[goal] = ties[0]!;
    }
    return {
        winners,
        stoppedEarly: skipped.length > 0,
        skipped,
        original: { bytes: glb.length, gpu: gpuEstimate(original).total, loadS: loadSeconds(original, glb.length, network, amortize), summary },
        elapsedMs: Date.now() - t0,
    };
}
