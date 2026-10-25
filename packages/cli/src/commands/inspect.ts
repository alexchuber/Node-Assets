import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, sep } from "node:path";

import { parse, stringFlag, viewSize } from "../arguments";
import { readDoc } from "../document";
import { commandHelp } from "../help";
import { canonicalizeInputs, collect, inputBytes, loadBytes, supportedInput } from "../inputs";
import { decoderWarnings, docSummary, extensionsOf, formatNotes, gpuEstimate, loadSeconds, NETWORKS, type Network } from "../measure";
import { asError, CliError, mib, out, progress, rel, seconds } from "../output";
import type { FidelityRenderer } from "../render";

export async function cmdInspect(argv: readonly string[]): Promise<number> {
    const { values, positionals } = parse("inspect", argv);
    if (values.help) {
        out(commandHelp("inspect"));
        return 0;
    }
    if (!positionals.length) throw new CliError("USAGE", "inspect requires an input", [commandHelp("inspect").usage]);
    const networkValue = stringFlag(values.network) ?? "4g";
    if (!Object.hasOwn(NETWORKS, networkValue)) throw new CliError("USAGE", "Unknown network", [`networks: ${Object.keys(NETWORKS).join(", ")}`]);
    const network = networkValue as Network;
    const view = viewSize(stringFlag(values.view));
    const against = stringFlag(values.against);
    const againstDirectory = against ? (await stat(against).catch(() => null))?.isDirectory() : false;
    const collected = await collect(positionals);
    const items = await canonicalizeInputs(collected.items);
    const models: Record<string, unknown>[] = [];
    const originals = new Map<string, { bytes: Uint8Array; row: Record<string, unknown> }>();
    const errors: CliError[] = [];
    const warnings = new Set<string>();
    let renderer: FidelityRenderer | undefined;
    let currentReference: string | undefined;
    try {
        for (const item of items) {
            if (item.skip) {
                models.push({ file: item.display, status: "skipped", detail: item.skip });
                continue;
            }
            try {
                if (item.error) throw item.error;
                const bytes = await loadBytes(item.input);
                const doc = await readDoc(bytes);
                const extensions = extensionsOf(doc);
                const diskBytes = await inputBytes(item.input);
                const row: Record<string, unknown> = {
                    file: item.display,
                    status: "ok",
                    bytes: diskBytes,
                    gpu_mib: mib(gpuEstimate(doc).total),
                    load_s: seconds(loadSeconds(doc, diskBytes, network)),
                    triangles: docSummary(doc).triangles,
                    textures: docSummary(doc).textures,
                    decoders: extensions.decoders.join("+") || "none",
                    required_extensions: extensions.required.join("+") || "none",
                };
                for (const warning of [...decoderWarnings(extensions.decoders), ...formatNotes(doc)]) warnings.add(warning);
                if (against) {
                    let original = against;
                    if (againstDirectory) {
                        const entries = (await readdir(against)).sort();
                        const stem = basename(item.name, extname(item.name));
                        const match = entries.find((entry) => supportedInput(entry) && basename(entry, extname(entry)) === stem);
                        if (!match) throw new CliError("INPUT_NOT_FOUND", `No original for ${item.display} in ${against}`, ["Pass the original directly: --against <original>"]);
                        original = against + sep + match;
                    }
                    if (!originals.has(original)) {
                        const path = await realpath(original).catch(() => {
                            throw new CliError("INPUT_NOT_FOUND", `${original}: no readable original file`);
                        });
                        const originalBytes = await loadBytes(path);
                        const originalDoc = await readDoc(originalBytes);
                        const size = await inputBytes(path);
                        originals.set(original, {
                            bytes: originalBytes,
                            row: { file: rel(original), bytes: size, gpu_mib: mib(gpuEstimate(originalDoc).total), load_s: seconds(loadSeconds(originalDoc, size, network)) },
                        });
                    }
                    renderer ??= (await import("../render")).createRenderer();
                    const reference = originals.get(original)!;
                    progress(`inspect: rendering ${item.display} against ${rel(original)} at ${view}px`);
                    if (currentReference !== original) {
                        currentReference = undefined;
                        await renderer.setReference(reference.bytes, { size: view, views: 4 });
                        currentReference = original;
                    }
                    row.against = rel(original);
                    row.fidelity = (await renderer.evaluate(bytes)).worst;
                    row.original = reference.row;
                }
                models.push(row);
            } catch (error) {
                const failure = asError(error);
                errors.push(failure);
                models.push({ file: item.display, status: "failed", code: failure.code, detail: failure.message, help: failure.help });
            }
        }
    } finally {
        await renderer?.stop();
    }
    if (models.length === 1 && errors.length === 1) throw errors[0]!;
    models.sort((a, b) => Number(b.bytes ?? -1) - Number(a.bytes ?? -1));
    const warningFields = warnings.size ? { warnings: [...warnings] } : {};
    const note = against ? { note: `fidelity = worst 64px-region SSIM over 4 views at ${view}px; load_s is estimated on ${network} with provisional decode coefficients` } : {};
    if (models.length === 1 && models[0]!.status === "ok") out({ ...models[0], ...warningFields, ...note });
    else out({ count: `${models.filter((row) => row.status === "ok").length} models found`, models, ...warningFields, ...note });
    return errors.length ? 1 : 0;
}
