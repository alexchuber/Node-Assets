import { stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { parse, stringFlag } from "../arguments";
import { writeAtomic } from "../files";
import { normalizeGraph, writeGraph } from "../graphFiles";
import { commandHelp } from "../help";
import { canonicalizeInputs, collect, inputHash, loadBytes } from "../inputs";
import { decoderBytes, decoderWarnings, NETWORKS, type Network } from "../measure";
import { asError, CliError, mib, out, progress, rel, seconds } from "../output";
import type { FidelityRenderer } from "../render";
import { allocatePassDeadline } from "../tune/budget";
import { createTuneExecutor } from "../tune/cache";
import { GOALS, type Goal } from "../tune/plan";
import { tune } from "../tune/search";
import { compileStages, type TuneStages } from "../tune/stages";

function duration(value: string): number {
    const match = /^(\d+(?:\.\d+)?)\s*(s|m|min|h)?$/.exec(value.trim());
    const ms = match ? Number(match[1]) * ({ s: 1000, m: 60000, min: 60000, h: 3600000 }[match[2] ?? "s"] ?? 0) : NaN;
    if (!Number.isFinite(ms) || ms <= 0) throw new CliError("USAGE", `invalid --time-limit "${value}"`, ["Use a positive duration, e.g. 90s, 5m, 1h"]);
    return ms;
}

function texturesLabel(stages: TuneStages): string {
    const t = stages.textures;
    const format = t.format === "keep" ? "original" : t.format === "ktx2" ? `ktx2 ${t.ktx2.color}+${t.ktx2.data}` : `${t.format} q${t.quality}/${t.dataQuality} (color/data maps)`;
    return `${format} <=${t.maxSize}px`;
}

function quote(argument: string): string {
    return /^[\w./,:=-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`;
}

export async function tuneCommandAsync(argv: readonly string[]): Promise<number> {
    const { values, positionals } = parse("tune", argv);
    if (values.help) {
        out(commandHelp("tune"));
        return 0;
    }
    if (!positionals.length) throw new CliError("USAGE", "missing <input>", [commandHelp("tune").usage]);
    const forValue = stringFlag(values.for);
    if (!forValue) throw new CliError("USAGE", "missing --for <goal>", [`goals: ${GOALS.join(", ")}`]);
    const goals: Goal[] = [];
    for (const goal of forValue.split(",").map((value) => value.trim())) {
        if (!(GOALS as readonly string[]).includes(goal)) throw new CliError("USAGE", `unknown goal "${goal}"`, [`goals: ${GOALS.join(", ")}`]);
        if (!goals.includes(goal as Goal)) goals.push(goal as Goal);
    }
    const floor = Number(stringFlag(values.fidelity) ?? 0.9);
    if (!(floor > 0 && floor <= 1)) throw new CliError("USAGE", "--fidelity must be greater than 0 and at most 1", ["e.g. --fidelity 0.9"]);
    const view = Number(stringFlag(values.view) ?? 1024);
    if (!Number.isInteger(view) || view < 64 || view > 4096) throw new CliError("USAGE", "--view must be an integer from 64 to 4096", ["e.g. --view 1024"]);
    const networkValue = stringFlag(values.network) ?? "4g";
    if (!Object.hasOwn(NETWORKS, networkValue)) throw new CliError("USAGE", "--network must be slow-4g, 4g or wifi");
    const network = networkValue as Network;
    const amortizeValue = stringFlag(values.amortize);
    if (amortizeValue !== undefined && (!Number.isInteger(Number(amortizeValue)) || Number(amortizeValue) < 1))
        throw new CliError("USAGE", "--amortize must be an integer of at least 1");
    const keepValue = stringFlag(values.keep);
    const keep = new Set(keepValue === undefined ? [] : keepValue.split(",").map((value) => value.trim()));
    for (const value of keep) if (!["hierarchy", "texture-size", "geometry"].includes(value)) throw new CliError("USAGE", "--keep accepts hierarchy, texture-size, geometry");
    const timeLimitValue = stringFlag(values["time-limit"]) ?? "7m";
    const timeLimitMs = duration(timeLimitValue);
    const deadline = Date.now() + timeLimitMs;
    const output = stringFlag(values.out) ?? ".";
    const fileOutput = !output.endsWith("/") && extname(output).toLowerCase() === ".toon" && !(await stat(output).catch(() => null))?.isDirectory();
    if (fileOutput && (positionals.length !== 1 || goals.length !== 1))
        throw new CliError("USAGE", "-o FILE.toon requires exactly one input and one goal", ["Use -o graphs/ for several inputs or goals"]);
    const { items: collected } = await collect(positionals);
    const items = await canonicalizeInputs(collected);
    const models = items.filter((item) => !item.error && !item.skip);
    if (fileOutput && models.length > 1) throw new CliError("USAGE", "-o FILE.toon requires exactly one input and one goal", ["Use -o graphs/ for several inputs or goals"]);
    const destinations = new Set<string>();
    for (const item of models)
        for (const goal of goals) {
            const file = fileOutput ? output : join(output, `${basename(item.name, extname(item.name))}.${goal}.toon`);
            const key = resolve(file).toLowerCase();
            if (destinations.has(key)) throw new CliError("USAGE", "Inputs would produce the same graph file", ["Tune these inputs separately with different -o paths"]);
            destinations.add(key);
        }
    const amortize = amortizeValue === undefined ? Math.max(1, models.length) : Number(amortizeValue);
    const passes: Goal[][] = goals.includes("compat") && goals.length > 1 ? [goals.filter((goal) => goal !== "compat"), ["compat"]] : [goals];
    const results: Record<string, unknown>[] = [];
    const originals: Record<string, unknown>[] = [];
    const warnings = new Set<string>();
    const failed: Record<string, unknown>[] = [];
    const executor = createTuneExecutor();
    let renderer: FidelityRenderer | undefined;
    try {
        for (const item of items) {
            if (item.error || item.skip) {
                failed.push({ input: item.display, code: item.error?.code ?? "UNSUPPORTED_FORMAT", detail: item.skip ?? item.error!.message });
                continue;
            }
            const name = basename(item.name, extname(item.name));
            try {
                const glb = await loadBytes(item.input);
                const hash = await inputHash(item.input);
                renderer ??= (await import("../render")).createRenderer();
                progress(`tune: ${item.display} for ${goals.join(",")} (fidelity >= ${floor} at ${view}px; whole run limited to ${timeLimitValue})`);
                for (const [passIndex, pass] of passes.entries()) {
                    const remainingPasses = (models.length - models.indexOf(item)) * passes.length - passIndex;
                    const searched = await tune(glb, hash, {
                        goals: pass,
                        floor,
                        view,
                        network,
                        amortize,
                        deadline: allocatePassDeadline(deadline, remainingPasses),
                        keep,
                        renderer,
                        executor,
                    });
                    for (const goal of pass) {
                        const winner = searched.winners[goal]!;
                        const result = {
                            bytes: winner.bytes,
                            decoders: winner.decoders.join("+") || "none",
                            gpu_mib: mib(winner.gpu),
                            load_s: seconds(winner.loadS),
                            fidelity: winner.fidelity,
                        };
                        const graph = normalizeGraph({
                            ...compileStages(winner.stages, searched.original.summary.maxTexture),
                            name: `${name}.${goal}`,
                            goal,
                            check: { fidelity: floor, view },
                            tuned: {
                                input: item.display,
                                date: new Date().toISOString().slice(0, 10),
                                renderer: renderer.browserName,
                                network,
                                amortized_over: amortize,
                                result,
                            },
                        });
                        const file = fileOutput ? output : join(output, `${name}.${goal}.toon`);
                        const preview = file.slice(0, -5) + ".png";
                        await renderer.evaluate(winner.glb);
                        const png = await renderer.preview(winner.worstView);
                        await writeGraph(file, graph);
                        await writeAtomic(preview, png);
                        const geometry = winner.stages.geometry;
                        results.push({
                            input: item.display,
                            goal,
                            graph: rel(file),
                            bytes: result.bytes,
                            decoder_bytes: Math.round(decoderBytes(winner.decoders) / amortize),
                            gpu_mib: result.gpu_mib,
                            load_s: result.load_s,
                            fidelity: result.fidelity,
                            textures: texturesLabel(winner.stages),
                            geometry: `${geometry.mode}${geometry.mode === "meshopt" ? "-" + geometry.meshoptLevel : ""}${geometry.simplify < 1 ? ` simplify ${geometry.simplify}` : ""}`,
                            decoders: result.decoders,
                            search: searched.stoppedEarly ? "partial" : "complete",
                            preview: rel(preview),
                        });
                        for (const warning of decoderWarnings(winner.decoders)) warnings.add(`${name}.${goal}: ${warning}`);
                        if (winner.required.includes("EXT_texture_avif"))
                            warnings.add(`${name}.${goal}: uses AVIF textures (EXT_texture_avif): no decoder download, but the browser must support AVIF`);
                    }
                    if (searched.stoppedEarly) {
                        const minutes = Math.min(9, Math.max(5, Math.ceil((searched.elapsedMs / 60000) * 3)));
                        const command = [
                            "node-assets",
                            "tune",
                            item.display,
                            "--for",
                            pass.join(","),
                            ...(floor === 0.9 ? [] : ["--fidelity", String(floor)]),
                            ...(view === 1024 ? [] : ["--view", String(view)]),
                            ...(network === "4g" ? [] : ["--network", network]),
                            ...(amortize > 1 ? ["--amortize", String(amortize)] : []),
                            ...(keep.size ? ["--keep", [...keep].join(",")] : []),
                            "--time-limit",
                            `${minutes}m`,
                            "-o",
                            output,
                        ]
                            .map(quote)
                            .join(" ");
                        warnings.add(
                            `${name} (${pass.join(",")}): time limit reached; not yet tried: ${searched.skipped.join(", ")}. Results are the best found so far. To finish: ${command}`
                        );
                    }
                    if (!originals.some((original) => original.input === item.display))
                        originals.push({ input: item.display, bytes: searched.original.bytes, gpu_mib: mib(searched.original.gpu), load_s: seconds(searched.original.loadS) });
                }
                executor.clear();
            } catch (error) {
                const failure = asError(error);
                failed.push({ input: item.display, code: failure.code, detail: failure.message, help: failure.help });
                executor.clear();
            }
        }
    } finally {
        executor.clear();
        await renderer?.stop();
    }
    out({
        limits: {
            fidelity: `>= ${floor} (worst 64px-region SSIM vs original, 4 views at ${view}px)`,
            network: `${network} (${NETWORKS[network]} Mbps)`,
            decoders_amortized_over: `${amortize} asset(s)`,
        },
        originals,
        results,
        ...(failed.length ? { failed } : {}),
        ...(warnings.size ? { warnings: [...warnings] } : {}),
        help: [
            "Run `node-assets run <graph> <input> -o <out.glb>` to apply a graph (add --check on other models to verify it suits them)",
            `Every result meets the fidelity limit at ${view}px (worst-region SSIM >= ${floor}; previews show the worst view). If the model will be shown larger or up close (VR, zoom), tune again with --view 2048; for extra margin, raise --fidelity`,
            "Edit a graph file to mix blocks from different goals, then use `node-assets run <graph> <input> -o <out.glb> --check`",
        ],
    });
    return failed.length ? 1 : 0;
}
