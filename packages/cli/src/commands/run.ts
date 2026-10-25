import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { parse, stringFlag } from "../arguments";
import { readDoc } from "../document";
import { executeGraph } from "../execution";
import { writeAtomic } from "../files";
import { graphHash, instantiateGraph, readGraph } from "../graphFiles";
import { commandHelp } from "../help";
import { canonicalizeInputs, collect, inputBytes, inputHash, invalidInput, loadBytes } from "../inputs";
import { decoderWarnings, extensionsOf, formatNotes, gpuEstimate, validate } from "../measure";
import { asError, CliError, mib, out, progress, rel } from "../output";
import { readProvenance, withProvenance } from "../provenance";
import type { FidelityRenderer } from "../render";

async function canonicalPath(file: string): Promise<string> {
    return realpath(file).catch(async () => join(await realpath(dirname(resolve(file))).catch(() => dirname(resolve(file))), basename(file)));
}

async function sameFile(left: string, right: string): Promise<boolean> {
    if ((await canonicalPath(left)) === right) return true;
    const [a, b] = await Promise.all([stat(left).catch(() => null), stat(right).catch(() => null)]);
    return !!a && !!b && a.dev === b.dev && a.ino === b.ino;
}

export async function cmdRun(argv: readonly string[]): Promise<number> {
    const { values, positionals } = parse("run", argv);
    if (values.help) {
        out(commandHelp("run"));
        return 0;
    }
    const [argument, ...inputs] = positionals;
    const outputArgument = stringFlag(values.out);
    if (!argument || !inputs.length || !outputArgument) throw new CliError("USAGE", "run requires a graph, input and -o output", [commandHelp("run").usage]);
    const collected = await collect(inputs);
    const items = await canonicalizeInputs(collected.items);
    const { multi } = collected;
    const outputDirectory = outputArgument.endsWith("/") || (await stat(outputArgument).catch(() => null))?.isDirectory();
    if (multi && !outputDirectory && extname(outputArgument)) throw new CliError("USAGE", "Several inputs or a directory require -o dir/", [commandHelp("run").usage]);
    const directory = !!outputDirectory || multi;
    if (!directory && extname(outputArgument).toLowerCase() !== ".glb") throw new CliError("USAGE", "Output must end in .glb", ["Use -o <out.glb|dir/>"]);
    const outputs = new Set<string>();
    const plans = [];
    for (const item of items) {
        const output = directory ? join(outputArgument, basename(item.name, extname(item.name)) + ".glb") : outputArgument;
        if (!item.error && !item.skip) {
            const canonical = (await canonicalPath(output)).toLowerCase();
            if (outputs.has(canonical)) throw new CliError("USAGE", "Inputs would produce the same output file", ["Run these inputs separately with different -o paths"]);
            outputs.add(canonical);
            for (const other of items) {
                if (!other.error && !other.skip && (await sameFile(output, other.input))) {
                    throw new CliError("USAGE", "An output is also an input; nothing written", ["Choose a separate output file or directory"]);
                }
            }
        }
        plans.push({ ...item, output });
    }
    const graph = await readGraph(argument);
    const hash = graphHash(graph);
    const results: Record<string, unknown>[] = [];
    const warnings = new Set<string>();
    const errors: CliError[] = [];
    let renderer: FidelityRenderer | undefined;
    let below = 0;
    try {
        for (const plan of plans) {
            if (plan.skip) {
                results.push({ input: plan.display, status: "skipped", detail: plan.skip });
                continue;
            }
            try {
                if (plan.error) throw plan.error;
                const provenance = { graph: hash, input: await inputHash(plan.input) };
                const previous = await readProvenance(plan.output);
                const exists = await lstat(plan.output).catch(() => null);
                const noop = !!exists && previous?.graph === provenance.graph && previous.input === provenance.input;
                if (exists && !noop && !values.force)
                    throw new CliError("OUTPUT_EXISTS", `${rel(plan.output)} already exists`, ["add --force to replace it, or choose another -o"]);
                let bytes: Uint8Array;
                if (noop) bytes = new Uint8Array(await readFile(plan.output));
                else {
                    progress(`run: ${plan.display}`);
                    try {
                        bytes = withProvenance(await executeGraph(instantiateGraph(graph), plan.input), provenance);
                    } catch (error) {
                        throw invalidInput(error, plan.display);
                    }
                }
                const doc = await readDoc(bytes);
                const extensions = extensionsOf(doc);
                for (const warning of [...decoderWarnings(extensions.decoders), ...formatNotes(doc)]) warnings.add(warning);
                const row: Record<string, unknown> = {
                    input: plan.display,
                    output: rel(plan.output),
                    status: noop ? "up to date (no-op)" : "ok",
                    bytes_before: await inputBytes(plan.input),
                    bytes_after: bytes.length,
                    gpu_mib: mib(gpuEstimate(doc).total),
                    decoders: extensions.decoders.join("+") || "none",
                };
                if (values.check) {
                    renderer ??= (await import("../render")).createRenderer();
                    const limit = graph.check ?? { fidelity: 0.9, view: 1024 };
                    progress(`run: checking ${rel(plan.output)} at ${limit.view}px`);
                    await renderer.setReference(await loadBytes(plan.input), { size: limit.view, views: 4 });
                    const fidelity = (await renderer.evaluate(bytes)).worst;
                    row.fidelity = fidelity;
                    row.check = fidelity >= limit.fidelity ? "pass" : "fail";
                    if (fidelity < limit.fidelity) {
                        row.status = "below limit";
                        below++;
                    }
                }
                if (!noop) {
                    const validation = await validate(bytes);
                    if (validation.errors) {
                        const original = await validate(await loadBytes(plan.input));
                        const inherited = original.errors > 0 && validation.codes.every((code) => original.codes.includes(code));
                        warnings.add(
                            `${rel(plan.output)}: ${validation.errors} validator error(s) [${validation.codes.join(", ")}]${inherited ? " already present in the input; written anyway" : " introduced by this graph"}`
                        );
                    }
                    await mkdir(dirname(plan.output), { recursive: true });
                    const destination = join(await realpath(dirname(plan.output)), basename(plan.output));
                    for (const other of items) {
                        if (!other.error && !other.skip && (await sameFile(destination, other.input))) {
                            throw new CliError("USAGE", "An output is also an input", ["Choose a separate output file or directory"]);
                        }
                    }
                    await writeAtomic(destination, bytes, !!values.force);
                }
                results.push(row);
            } catch (error) {
                const failure = asError(error);
                errors.push(failure);
                results.push({ input: plan.display, status: "failed", code: failure.code, detail: failure.message, help: failure.help });
            }
        }
    } finally {
        await renderer?.stop();
    }
    if (plans.length === 1 && errors.length === 1) throw errors[0]!;
    const written = results.filter((row) => row.status === "ok" || row.status === "up to date (no-op)" || row.status === "below limit");
    const skipped = results.filter((row) => row.status === "skipped").length;
    const help: string[] = [];
    if (below) help.push(`${below} output(s) fell below the fidelity limit: node-assets tune <input> --for <goal>`);
    if (!values.check && written.length) help.push("node-assets inspect <output> --against <input>: measure fidelity and load time");
    out({
        count: `${written.length} written or up to date, ${errors.length} failed, ${skipped} skipped`,
        results,
        ...(written.length
            ? {
                  total: `${Math.round(written.reduce((sum, row) => sum + Number(row.bytes_before), 0))} bytes -> ${Math.round(written.reduce((sum, row) => sum + Number(row.bytes_after), 0))} bytes`,
              }
            : {}),
        ...(warnings.size ? { warnings: [...warnings] } : {}),
        ...(help.length ? { help } : {}),
    });
    return errors.length || below ? 1 : 0;
}
