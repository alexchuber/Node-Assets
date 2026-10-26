import { stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { readDocAsync } from "../../src/document";
import { writeAtomicAsync } from "../../src/files";
import { loadBytesAsync } from "../../src/inputs";
import { features, type LoadFeatures } from "../../src/loadModel";
import { asError, CliError, out, progress, withDiagnosticsAsync } from "../../src/output";

import { startColdLoaderAsync } from "./coldLoad";
import { fitLoadModel } from "./fit";
import { calibrationVariants, executeVariantAsync, type Variant } from "./variants";

interface CalibrationRow extends Variant {
    readonly input: string;
    readonly bytes: number;
    readonly ms: number;
    readonly spread: number;
    readonly samples: readonly number[];
    readonly features: LoadFeatures;
    readonly decoders: readonly string[];
}

function help(): void {
    out({
        description: "DEV ONLY: fit deterministic load estimates to Babylon.js cold GLB loads.",
        usage: "node packages/cli/.dev/calibrate.js --out calib.json [--reps 5] [--variants 16] [--write] <model.glb>...",
        flags: {
            out: "required; JSON report (measurements, features, fit, validation)",
            reps: "positive integer, default 5; fresh browser context per measurement",
            variants: "first N variants per model, default 16; 3 exercises KTX2, meshopt and Draco",
            write: "replace src/loadModel.coefficients.json after a successful full-variant fit; rebuild CLI afterward",
            help: "show this reference",
        },
        examples: [
            "node packages/cli/.dev/calibrate.js --out packages/cli/.cache/smoke.json --variants 3 --reps 1 packages/cli/.cache/models/Duck.glb",
            "node packages/cli/.dev/calibrate.js --out packages/cli/.cache/calib.json --write helmet.glb toycar.glb lantern.glb boombox.glb",
        ],
    });
}

function positiveInteger(value: string | undefined, fallback: number, flag: string): number {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) throw new CliError("USAGE", `${flag}: expected a positive integer`);
    return number;
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function mainAsync(): Promise<void> {
    let args;
    try {
        args = parseArgs({
            allowPositionals: true,
            options: {
                out: { type: "string" },
                reps: { type: "string" },
                variants: { type: "string" },
                write: { type: "boolean", default: false },
                help: { type: "boolean", default: false },
            },
        });
    } catch (error) {
        throw new CliError("USAGE", error instanceof Error ? error.message : String(error), ["Valid flags: --out FILE, --reps N, --variants N, --write, --help"]);
    }
    if (args.values.help) return help();
    const { positionals: inputs, values } = args;
    if (!values.out || !inputs.length) throw new CliError("USAGE", "--out FILE and at least one input GLB are required", ["node packages/cli/.dev/calibrate.js --help"]);
    const reps = positiveInteger(values.reps, 5, "--reps");
    const allVariants = calibrationVariants();
    const limit = positiveInteger(values.variants, allVariants.length, "--variants");
    if (limit > allVariants.length) throw new CliError("USAGE", `--variants: at most ${allVariants.length}`);
    const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const coefficientsPath = resolve(cliRoot, "src/loadModel.coefficients.json");
    if (resolve(values.out) === coefficientsPath || inputs.some((input) => resolve(input) === resolve(values.out!))) {
        throw new CliError("USAGE", "--out must not replace an input or the coefficients source");
    }
    if (values.write && (limit < allVariants.length || new Set(inputs.map((input) => resolve(input))).size < 2)) {
        throw new CliError("USAGE", "--write requires all 16 variants and at least two different models; use four representative models");
    }
    for (const input of inputs) {
        if (extname(input).toLowerCase() !== ".glb") throw new CliError("USAGE", `${input}: calibration accepts GLB files only`);
        if (!(await stat(input).catch(() => null))?.isFile()) throw new CliError("INPUT_NOT_FOUND", `${input}: no readable model`);
    }
    const variants = allVariants.slice(0, limit);
    progress(`Calibrating ${inputs.length} model(s), ${variants.length} variants each, ${reps} cold load(s) per variant.`);
    const loader = await startColdLoaderAsync(cliRoot);
    const rows: CalibrationRow[] = [];
    let babylonVersion = "";
    try {
        for (const input of inputs) {
            const original = await loadBytesAsync(input);
            for (const variant of variants) {
                const bytes = await executeVariantAsync(original, variant);
                const observed = features(await readDocAsync(bytes), bytes.byteLength);
                const samples: number[] = [];
                const decoders = new Set<string>();
                for (let repetition = 0; repetition < reps; repetition++) {
                    const result = await loader.measureAsync(bytes);
                    babylonVersion = result.babylonVersion;
                    samples.push(result.ms);
                    result.decoders.forEach((name) => decoders.add(name));
                }
                const ms = median(samples);
                const spread = Math.max(...samples) - Math.min(...samples);
                rows.push({ input: resolve(input), ...variant, bytes: bytes.byteLength, ms, spread, samples, features: observed, decoders: [...decoders].sort() });
                progress(`${input} ${variant.tex}@${variant.size} ${variant.geo}: ${ms.toFixed(1)} ms (spread ${spread.toFixed(1)}), ${bytes.byteLength} bytes`);
            }
        }
    } finally {
        await loader.stopAsync();
    }
    const fit = fitLoadModel(rows);
    const source = `Babylon.js ${babylonVersion}, ${loader.browserName}, ${new Date().toISOString().slice(0, 10)}`;
    const worst = rows
        .map((row, index) => ({
            input: row.input,
            tex: row.tex,
            size: row.size,
            geo: row.geo,
            measuredMs: row.ms,
            predictedMs: fit.predicted[index]!,
            errorMs: row.ms - fit.predicted[index]!,
            spreadMs: row.spread,
        }))
        .sort((a, b) => Math.abs(b.errorMs) - Math.abs(a.errorMs))
        .slice(0, 5);
    const warnings = [];
    if (new Set(rows.map((row) => row.input)).size < 2) warnings.push("Leave-one-model-out validation needs multiple models; a smoke fit is not a usable calibration.");
    if (rows.length < Object.keys(fit.coefficients).length) warnings.push("Underdetermined fit: fewer rows than coefficients.");
    if (reps < 5) warnings.push("Use --reps 5 on an idle machine for a real calibration.");
    const absent = Object.keys(fit.coefficients).filter((key) => key !== "c0" && rows.every((row) => !row.features[key]));
    if (absent.length) warnings.push(`Unobserved features (coefficients fit to zero): ${absent.join(", ")}`);
    const report = {
        source,
        reps,
        variantsPerModel: variants.length,
        coefficients: fit.coefficients,
        fitted: fit.fitted,
        leaveOneModelOut: fit.leaveOneModelOut,
        worst,
        warnings,
        decoderFiles: loader.decoders,
        rows,
    };
    await writeAtomicAsync(values.out, JSON.stringify(report, null, 4) + "\n");
    if (values.write) {
        await writeAtomicAsync(coefficientsPath, JSON.stringify({ coefficients: fit.coefficients, source, fitted: fit.fitted }, null, 4) + "\n");
    }
    out({
        source,
        n: fit.fitted.n,
        R2: fit.fitted.r2,
        MAE_ms: fit.fitted.maeMs,
        leaveOneModelOut: fit.leaveOneModelOut,
        worst,
        COEF: fit.coefficients,
        warnings,
        report: values.out,
        wroteCoefficients: values.write,
        ...(values.write ? { next: "pnpm --filter node-assets-cli build" } : {}),
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    void withDiagnosticsAsync(mainAsync).catch((error: unknown) => {
        const failure = asError(error);
        out({ error: failure.message, code: failure.code, help: failure.help });
        process.exitCode = failure.exit;
    });
}
