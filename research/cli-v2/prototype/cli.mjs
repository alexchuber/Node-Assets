// node-assets CLI (AXI-style): TOON on stdout, progress on stderr, structured errors, content-first home view.
import { parseArgs } from "node:util";
import { readdir, stat, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { VERSION } from "./version.mjs";
import { loadBytes, applyRecipe, readDoc, inputBytes, EngineError, ALL_IN, unsupportedHint, DEFAULT_RECIPE, sha, readProvenance } from "./engine.mjs";
import { gpuEstimate, extensionsOf, DECODERS, NETWORKS, docSummary, validate, decoderBytes } from "./measure.mjs";
import { readRecipe, writeRecipe, normalizeRecipe, recipeHash, serialize, RecipeError } from "./recipe.mjs";
import { features, decodeMs } from "./loadmodel.mjs";

const FORMAT = process.env.NA_FORMAT === "json" ? "json" : "toon";
const TUNE = process.env.NA_TUNE !== "0";
const RECIPE_EXT = FORMAT === "json" ? ".recipe.json" : ".recipe.toon";
const TABLE_EXT = FORMAT === "json" ? ".tune.json" : ".tune.toon";

class CliError extends Error {
    constructor(code, message, help = [], exit = 1) {
        super(message);
        this.code = code;
        this.help = help;
        this.exit = exit;
    }
}
const out = (obj) => process.stdout.write(serialize(obj, FORMAT));
const progress = (s) => process.stderr.write(s + "\n");
const rel = (p) => {
    const r = path.relative(process.cwd(), p);
    return r && !r.startsWith("..") ? r : p;
};
const mb = (b) => Math.round((b / 1e6) * 1000) / 1000;
const mib = (b) => Math.round((b / 1048576) * 10) / 10;
const s3 = (x) => Math.round(x * 100) / 100;

// ---------------- flags (strict, per command; unknown flags list the valid ones) ----------------
const FLAGS = {
    inspect: { against: { type: "string" }, view: { type: "string" }, network: { type: "string" } },
    optimize: {
        out: { type: "string", short: "o" },
        force: { type: "boolean", short: "f" },
        "texture-format": { type: "string" },
        "texture-quality": { type: "string" },
        "texture-data-quality": { type: "string" },
        "texture-size": { type: "string" },
        ktx2: { type: "string" },
        geometry: { type: "string" },
        simplify: { type: "string" },
        "meshopt-level": { type: "string" },
        "draco-bits": { type: "string" },
        "keep-hierarchy": { type: "boolean" },
    },
    tune: {
        for: { type: "string" },
        fidelity: { type: "string" },
        view: { type: "string" },
        network: { type: "string" },
        amortize: { type: "string" },
        keep: { type: "string" },
        "time-limit": { type: "string" },
        out: { type: "string", short: "o" },
    },
    run: { out: { type: "string", short: "o" }, force: { type: "boolean", short: "f" }, check: { type: "boolean" } },
    setup: { skill: { type: "boolean" }, hook: { type: "boolean" } },
};
function parse(cmd, argv) {
    const options = { ...FLAGS[cmd], help: { type: "boolean", short: "h" } };
    try {
        return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    } catch (e) {
        const m = /Unknown option '([^']+)'/.exec(e.message) || /Option '([^']+)'/.exec(e.message);
        const valid = Object.keys(FLAGS[cmd]).map((f) => `--${f}`).join(", ");
        throw new CliError("USAGE", m ? `unknown or malformed flag ${m[1]} for \`${cmd}\`` : e.message.split(".")[0], [`valid flags for ${cmd}: ${valid} (--help always allowed)`], 2);
    }
}

// ---------------- help ----------------
const HELP = {
    inspect: () => ({
        usage: "node-assets inspect <file|dir>... [--against <original|dir>] [--view 1024] [--network 4g]",
        description: "Read-only. Size, GPU memory estimate, estimated load time on --network, triangles, textures and required decoders. With --against, also renders each file and its original and reports fidelity (worst 64px-region SSIM over 4 views) and load time. --against <file> compares every input with that file; --against <dir> compares each input with the file of the same name in that directory.",
        examples: ["node-assets inspect assets/", "node-assets inspect out/helmet.glb --against assets/helmet.glb", "node-assets inspect public/models/ --against assets/"],
    }),
    optimize: () => ({
        usage: "node-assets optimize <input>... -o <file.glb|dir/> [lever flags] [--force]",
        description: "Apply the default recipe (WebP textures <=2048px, quantized geometry, lossless cleanup), with any lever overridden by flags. Several inputs or a directory need -o <dir/>.",
        flags: [
            "--texture-format keep|webp|avif|jpeg|png|ktx2 (default webp)",
            "--texture-quality 1-100 for color maps (default 90)",
            "--texture-data-quality 1-100 for normal, metal/rough and occlusion maps (default: max(--texture-quality, 95))",
            "--texture-size <px> max texture side (default 2048)",
            "--ktx2 etc1s|uastc|etc1s+uastc (color+data modes when --texture-format ktx2; default etc1s+uastc)",
            "--geometry quantize|meshopt|draco|none (default quantize)",
            "--simplify <ratio> keep this share of triangles, 0.05-1 (default 1)",
            "--meshopt-level medium|high",
            "--draco-bits P,N,T quantization bits for positions, normals, texcoords (default 14,10,12)",
            "--keep-hierarchy  do not flatten or instance nodes",
            "-f, --force  replace existing outputs",
        ],
        examples: ["node-assets optimize assets/helmet.glb -o public/models/helmet.glb", "node-assets optimize assets/ -o public/models/ --force --geometry meshopt"],
    }),
    tune: () => ({
        usage: "node-assets tune <input>... --for size|gpu|load|compat[,...] [-o <dir>] [--fidelity 0.9] [--view 1024] [--network 4g] [--amortize N] [--keep hierarchy,texture-size,geometry] [--time-limit 7m]",
        description:
            "Search the levers (texture format and size, quality for color and data maps separately, KTX2 modes, geometry quantize/meshopt/draco and their bits, simplification, dedup/weld/instancing/flattening) for the best result per goal, never going below the fidelity limit. The most promising settings are tried first, so a run stopped by --time-limit still returns good results (marked search: partial). Writes one recipe per input and goal plus a preview image and the full candidate table; does not write models (use `run`).",
        goals: [
            "size: smallest download, counting decoder downloads (shared across --amortize assets)",
            "gpu: lowest estimated GPU memory (textures + vertex data)",
            "load: fastest load = download time on --network + decode time estimated from the file's contents",
            "compat: fewest required glTF extensions (no decoders), then smallest",
        ],
        limits: ["--time-limit: total budget for the whole run (default 7m); when it runs out the best results so far are written, and a warning gives the command that finishes the search", "--fidelity: worst 64px-region SSIM vs the original over 4 views at --view px (default 0.9 at 1024px, the recommended limit for no visible quality loss)", "--network: slow-4g (1.6 Mbps) | 4g (9 Mbps, default) | wifi (30 Mbps)"],
        examples: ["node-assets tune assets/helmet.glb --for size,gpu -o recipes/", "node-assets tune assets/*.glb --for load --network slow-4g -o recipes/"],
    }),
    run: () => ({
        usage: "node-assets run <recipe> <input>... -o <file.glb|dir/> [--check] [--force]",
        description: "Apply a recipe (TOON or JSON) to one or more models. --check renders each result and compares it with its input against the recipe's fidelity limit; inputs that fall below are reported.",
        examples: ["node-assets run recipes/helmet.size.recipe.toon assets/helmet.glb -o public/models/helmet.glb", "node-assets run recipes/helmet.size.recipe.toon assets/ -o public/models/ --check --force"],
    }),
};
HELP.setup = () => ({
    usage: "node-assets setup [--hook] [--skill]",
    description: "Opt-in agent integration for the current project. --hook adds a Claude Code SessionStart hook (.claude/settings.json) that shows this tool's home view (models, recipes, commands) at the start of every session. --skill writes .claude/skills/node-assets/SKILL.md from the same text so agents load it on demand. Re-running is a no-op; a moved executable path is repaired.",
    examples: ["node-assets setup --hook", "node-assets setup --skill"],
});
const COMMANDS = TUNE ? ["inspect", "optimize", "tune", "run", "setup"] : ["inspect", "optimize", "setup"];

// ---------------- inputs ----------------
const SKIP_EXT = [".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".mtl", ".txt", ".md", ".json", ".toon", ".html", ".js", ".css"];
async function collect(positionals) {
    const items = [];
    let dir = false;
    for (const p of positionals) {
        const st = await stat(p).catch(() => null);
        if (!st) items.push({ input: p, error: new CliError("INPUT_NOT_FOUND", `${p}: no such file or directory`, [`paths are relative to ${process.cwd()}`]) });
        else if (st.isDirectory()) {
            dir = true;
            for (const d of (await readdir(p, { withFileTypes: true })).filter((d) => d.isFile() && !d.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
                const ext = path.extname(d.name).toLowerCase();
                if (ALL_IN.includes(ext)) items.push({ input: path.join(p, d.name) });
                else if (!SKIP_EXT.includes(ext)) items.push({ input: path.join(p, d.name), skip: `${ext || "(no extension)"} is not a supported input; ${unsupportedHint(ext)}` });
            }
        } else items.push({ input: p });
    }
    return { items, multi: dir || positionals.length > 1 };
}
const asError = (e) => (e instanceof CliError ? e : e instanceof EngineError || e instanceof RecipeError ? new CliError(e.code, e.message, e.hint ? [e.hint] : []) : new CliError("INTERNAL", String(e?.message ?? e).split("\n")[0]));

async function writeAtomic(file, bytes) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
    try {
        await writeFile(tmp, bytes);
        await rename(tmp, file);
    } catch (e) {
        await rm(tmp, { force: true });
        throw e;
    }
}

// Image formats that need no decoder download but do need loader + browser support.
function formatNotes(doc) {
    const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
    return used.includes("EXT_texture_avif") ? ["uses AVIF textures (EXT_texture_avif): loaded natively by three.js r150+ and Babylon.js 7.10+, no decoder download; the browser must support AVIF"] : [];
}

function decoderWarnings(names) {
    return [...new Set(names)].map((n) => {
        const d = Object.values(DECODERS).find((x) => x.name === n);
        return `output needs the ${n} decoder (${Math.round(d.bytes / 1000)} KB gzip) in the viewer: three.js ${d.three}; Babylon.js loads it automatically`;
    });
}

// Shared by optimize and run: apply a recipe to inputs, idempotently.
async function applyToInputs(recipe, positionals, outArg, force, check, cmd) {
    if (!positionals.length) throw new CliError("USAGE", `missing <input> for ${cmd}`, [HELP[cmd]().usage], 2);
    if (!outArg) throw new CliError("USAGE", "missing -o <output>", [`${HELP[cmd]().usage}`], 2);
    const { items, multi } = await collect(positionals);
    const outIsDir = multi || outArg.endsWith("/") || (await stat(outArg).then((s) => s.isDirectory()).catch(() => false));
    if (multi && path.extname(outArg).toLowerCase() === ".glb") throw new CliError("USAGE", `-o must be a directory with several inputs (got ${outArg})`, ["e.g. -o public/models/"], 2);
    const rh = recipeHash(recipe);
    const results = [], warnings = [], decoders = [], notes = [];
    let render;
    for (const it of items) {
        if (it.error) {
            results.push({ input: rel(it.input), status: "failed", detail: it.error.message });
            continue;
        }
        if (it.skip) {
            results.push({ input: rel(it.input), status: "skipped", detail: it.skip });
            continue;
        }
        const output = outIsDir ? path.join(outArg, path.basename(it.input, path.extname(it.input)) + ".glb") : outArg;
        try {
            if (!outIsDir && path.extname(output).toLowerCase() !== ".glb") throw new CliError("USAGE", `output must end in .glb (got ${output})`, ["name the output <name>.glb"], 2);
            const glb = await loadBytes(it.input);
            const provenance = { recipe: rh, input: sha(glb) };
            const prev = await readProvenance(output);
            const exists = await stat(output).then(() => true).catch(() => false);
            if (exists && prev && prev.recipe === provenance.recipe && prev.input === provenance.input && !check) {
                results.push({ input: rel(it.input), output: rel(output), status: "up to date (no-op)" });
                continue;
            }
            if (exists && !force && !(prev && prev.recipe === provenance.recipe && prev.input === provenance.input))
                throw new CliError("OUTPUT_EXISTS", `${rel(output)} already exists and was not produced by this recipe from this input; nothing written`, [`add --force to replace it, or choose another -o`]);
            progress(`${cmd}: ${rel(it.input)}`);
            const { bytes, doc } = await applyRecipe(glb, recipe, provenance);
            const ex = extensionsOf(doc);
            const v = await validate(bytes);
            const row = { input: rel(it.input), output: rel(output), status: "ok", bytes_before: await inputBytes(it.input), bytes_after: bytes.length, gpu_mib: mib(gpuEstimate(doc).total), decoders: ex.decoders.join("+") || "none" };
            if (v.errors) {
                const inV = await validate(glb);
                const inherited = inV.errors > 0 && v.codes.every((c) => inV.codes.includes(c));
                warnings.push(`${row.output}: ${v.errors} validator error(s) [${v.codes.join(", ")}]${inherited ? " already present in the input; written anyway" : " introduced by this recipe"}`);
            }
            if (check) {
                render ??= await import("./render.mjs");
                const lim = recipe.check ?? { fidelity: 0.9, view: 1024, views: 4 };
                await render.setReference(glb, { size: lim.view, views: lim.views });
                const f = (await render.evaluate(bytes)).worst;
                row.fidelity = f;
                row.check = f >= lim.fidelity ? "pass" : `FAIL (< ${lim.fidelity})`;
            }
            await writeAtomic(output, bytes);
            decoders.push(...ex.decoders);
            notes.push(...formatNotes(doc));
            results.push(row);
        } catch (e) {
            const ce = asError(e);
            if (ce.exit === 2 && !multi) throw ce;
            results.push({ input: rel(it.input), status: "failed", detail: `${ce.code}: ${ce.message}${ce.help[0] ? `; ${ce.help[0]}` : ""}` });
        }
    }
    if (render) await render.stopRenderer();
    warnings.unshift(...decoderWarnings(decoders), ...new Set(notes));
    const ok = results.filter((r) => r.status === "ok" || r.status.startsWith("up to date"));
    const failed = results.filter((r) => r.status === "failed").length;
    const checkFails = results.filter((r) => r.check && r.check !== "pass").length;
    const res = { count: `${ok.length} written or up to date, ${failed} failed, ${results.filter((r) => r.status === "skipped").length} skipped`, results };
    const written = ok.filter((r) => r.bytes_after !== undefined);
    if (written.length) res.total = `${mb(written.reduce((a, r) => a + r.bytes_before, 0))} MB -> ${mb(written.reduce((a, r) => a + r.bytes_after, 0))} MB`;
    if (warnings.length) res.warnings = warnings;
    const help = [];
    if (checkFails) help.push(`${checkFails} output(s) fell below the fidelity limit: tune them separately with \`node-assets tune <input> --for <goal>\``);
    if (!check && ok.length) help.push(`Run \`node-assets inspect <output> --against <input>\` to measure fidelity and load time`);
    if (help.length) res.help = help;
    out(res);
    return failed || checkFails ? 1 : 0;
}

// ---------------- commands ----------------
async function cmdInspect(argv) {
    const { values, positionals } = parse("inspect", argv);
    if (values.help) return out(HELP.inspect()), 0;
    if (!positionals.length) throw new CliError("USAGE", "missing <file|dir>", [HELP.inspect().usage], 2);
    const network = values.network ?? "4g";
    if (!NETWORKS[network]) throw new CliError("USAGE", `--network must be one of ${Object.keys(NETWORKS).join(", ")}`, [], 2);
    const { items } = await collect(positionals);
    const rows = [];
    for (const it of items) {
        if (it.error || it.skip) {
            rows.push({ file: rel(it.input), status: it.skip ? "skipped" : "failed", detail: it.skip ?? it.error.message });
            continue;
        }
        try {
            const glb = await loadBytes(it.input);
            const doc = await readDoc(glb);
            const s = docSummary(doc);
            const ex = extensionsOf(doc);
            const bytes = await inputBytes(it.input);
            const loadS = ((bytes + decoderBytes(ex.decoders)) * 8) / (NETWORKS[network] * 1e6) + decodeMs(features(doc, glb.length)) / 1000;
            rows.push({ file: rel(it.input), status: "ok", bytes, gpu_mib: mib(gpuEstimate(doc).total), load_s: s3(loadS), triangles: s.triangles, textures: s.textures, decoders: ex.decoders.join("+") || "none", required_extensions: ex.required.join("+") || "none", _glb: glb });
        } catch (e) {
            const ce = asError(e);
            rows.push({ file: rel(it.input), status: "failed", detail: `${ce.code}: ${ce.message}` });
        }
    }
    const ok = rows.filter((r) => r.status === "ok");
    if (values.against) {
        if (!ok.length) throw new CliError("INPUT_NOT_FOUND", "no readable model to compare", [HELP.inspect().usage]);
        // --against FILE: every input is compared with it. --against DIR: each input with the file of the same name there.
        const againstIsDir = await stat(values.against).then((s) => s.isDirectory()).catch(() => false);
        const pairOf = async (r) => {
            if (!againstIsDir) return values.against;
            const stem = path.basename(r.file, path.extname(r.file));
            const hit = (await readdir(values.against)).find((n) => path.basename(n, path.extname(n)) === stem && ALL_IN.includes(path.extname(n).toLowerCase()));
            if (!hit) throw new CliError("INPUT_NOT_FOUND", `no file named ${stem}.* in ${values.against} to compare ${r.file} with`, [`pass the original directly: --against ${path.join(values.against, stem + ".glb")}`]);
            return path.join(values.against, hit);
        };
        const render = await import("./render.mjs");
        const view = values.view ? parseInt(values.view, 10) : 1024;
        const originals = new Map(), compared = [];
        try {
            for (const r of ok) {
                const orig = await pairOf(r);
                if (!originals.has(orig)) {
                    const g = await loadBytes(orig).catch((e) => {
                        throw asError(e);
                    });
                    const d = await readDoc(g);
                    originals.set(orig, { glb: g, row: { file: rel(orig), bytes: await inputBytes(orig), gpu_mib: mib(gpuEstimate(d).total), load_s: s3((g.length * 8) / (NETWORKS[network] * 1e6) + decodeMs(features(d, g.length)) / 1000) }, ref: false });
                }
                const o = originals.get(orig);
                progress(`inspect: rendering ${r.file} against ${rel(orig)} at ${view}px`);
                if (!o.ref) {
                    for (const x of originals.values()) x.ref = false;
                    await render.setReference(o.glb, { size: view, views: 4 });
                    o.ref = true;
                }
                const f = await render.evaluate(r._glb);
                const candMs = decodeMs(features(await readDoc(r._glb), r._glb.length));
                const decBytes = decoderBytes(r.decoders === "none" ? [] : r.decoders.split("+"));
                const net = ((r.bytes + decBytes) * 8) / (NETWORKS[network] * 1e6);
                delete r._glb;
                const { status, ...rest } = r;
                compared.push({ ...rest, against: rel(orig), fidelity: f.worst, load_s: s3(net + candMs / 1000), load_detail: `${s3(net)}s download on ${network} incl. ${Math.round(decBytes / 1000)} KB decoders + ${s3(candMs / 1000)}s decode (estimated)` });
            }
        } finally {
            await render.stopRenderer();
        }
        const note = `fidelity = worst 64px-region SSIM over 4 views at ${view}px (1 = identical; 0.9 or higher is the recommended limit for no visible quality loss); load_s = download on ${network} + decode time estimated from the file's contents (model fitted to cold loads in headless Chromium)`;
        const bad = rows.filter((r) => r.status !== "ok");
        if (compared.length === 1 && !bad.length) out({ ...compared[0], note, original: originals.values().next().value.row });
        else {
            const res = { compared, originals: [...originals.values()].map((o) => o.row), note };
            if (bad.length) res.not_read = bad.map(({ _glb, ...r }) => r);
            out(res);
        }
        return bad.length ? 1 : 0;
    }
    for (const r of rows) delete r._glb;
    if (rows.length === 1 && !ok.length && rows[0].status === "failed") {
        const [code, ...msg] = rows[0].detail.split(": ");
        throw new CliError(code in { INVALID_INPUT: 1, INPUT_NOT_FOUND: 1, UNSUPPORTED_FORMAT: 1 } ? code : "INVALID_INPUT", msg.join(": ") || rows[0].detail, []);
    }
    if (rows.length === 1 && ok.length === 1) out(rows[0]);
    else {
        ok.sort((a, b) => b.bytes - a.bytes);
        const res = { count: `${ok.length} models, ${mb(ok.reduce((a, r) => a + r.bytes, 0))} MB total`, models: ok.map(({ status, ...r }) => r) };
        const bad = rows.filter((r) => r.status !== "ok");
        if (bad.length) res.not_read = bad;
        if (!ok.length) res.count = "0 models found";
        out(res);
    }
    return rows.some((r) => r.status === "failed") ? 1 : 0;
}

function recipeFromFlags(v) {
    const r = structuredClone(DEFAULT_RECIPE);
    const t = r.stages.textures, g = r.stages.geometry, c = r.stages.cleanup;
    if (v["texture-format"]) t.format = v["texture-format"];
    if (v["texture-quality"]) t.quality = Number(v["texture-quality"]), (t.dataQuality = Math.max(t.quality, 95));
    if (v["texture-data-quality"]) t.dataQuality = Number(v["texture-data-quality"]);
    if (v["draco-bits"]) {
        const b = v["draco-bits"].split(",").map(Number);
        if (b.length !== 3 || b.some((x) => !Number.isInteger(x))) throw new CliError("USAGE", `--draco-bits takes three integers P,N,T (got ${v["draco-bits"]})`, ["e.g. --draco-bits 14,10,12 (positions 8-16, normals 6-14, texcoords 8-16)"], 2);
        [g.dracoPosition, g.dracoNormal, g.dracoTexcoord] = b;
    }
    if (v["texture-size"]) t.maxSize = Number(v["texture-size"]);
    if (v.ktx2) {
        const [color, data = color] = v.ktx2.split("+");
        t.ktx2 = { ...t.ktx2, color, data };
    }
    if (v.geometry) g.mode = v.geometry;
    if (v.simplify) g.simplify = Number(v.simplify);
    if (v["meshopt-level"]) g.meshoptLevel = v["meshopt-level"];
    c.flatten = !v["keep-hierarchy"];
    c.instance = !v["keep-hierarchy"];
    try {
        return normalizeRecipe(r);
    } catch (e) {
        throw new CliError("USAGE", e.message.replace("stages.", "").replace(/^textures\.|^geometry\./, "--"), [HELP.optimize().flags.join("; ")], 2);
    }
}

async function cmdOptimize(argv) {
    const { values, positionals } = parse("optimize", argv);
    if (values.help) return out(HELP.optimize()), 0;
    return applyToInputs(recipeFromFlags(values), positionals, values.out, values.force, false, "optimize");
}

async function cmdRun(argv) {
    const { values, positionals } = parse("run", argv);
    if (values.help) return out(HELP.run()), 0;
    const [recipeFile, ...inputs] = positionals;
    if (!recipeFile) throw new CliError("USAGE", "missing <recipe>", [HELP.run().usage], 2);
    const recipe = await readRecipe(recipeFile).catch((e) => {
        throw asError(e);
    });
    return applyToInputs(recipe, inputs, values.out, values.force, values.check, "run");
}

const parseDuration = (s) => {
    const m = /^(\d+(?:\.\d+)?)\s*(s|m|min|h)?$/.exec(String(s).trim());
    if (!m) throw new CliError("USAGE", `invalid --time-limit "${s}"`, ["e.g. 90s, 5m, 1h"], 2);
    return parseFloat(m[1]) * { s: 1e3, m: 6e4, min: 6e4, h: 3.6e6 }[m[2] ?? "s"];
};

async function cmdTune(argv) {
    const { values, positionals } = parse("tune", argv);
    if (values.help) return out(HELP.tune()), 0;
    if (!positionals.length) throw new CliError("USAGE", "missing <input>", [HELP.tune().usage], 2);
    if (!values.for) throw new CliError("USAGE", "missing --for <goal>", ["goals: size, gpu, load, compat (comma-separate several; one recipe is written per goal)", "e.g. node-assets tune assets/helmet.glb --for size,gpu -o recipes/"], 2);
    const { GOALS, tune } = await import("./tune.mjs");
    const goals = values.for.split(",").map((s) => s.trim());
    for (const g of goals) if (!GOALS.includes(g)) throw new CliError("USAGE", `unknown goal "${g}"`, [`goals: ${GOALS.join(", ")}`], 2);
    const floor = values.fidelity ? Number(values.fidelity) : 0.9;
    if (!(floor > 0 && floor <= 1)) throw new CliError("USAGE", "--fidelity must be between 0 and 1", ["e.g. --fidelity 0.9 (1 = identical renders)"], 2);
    const view = values.view ? parseInt(values.view, 10) : 1024;
    const network = values.network ?? "4g";
    if (!NETWORKS[network]) throw new CliError("USAGE", `--network must be one of ${Object.keys(NETWORKS).join(", ")}`, [], 2);
    const keep = new Set((values.keep ?? "").split(",").filter(Boolean));
    for (const k of keep) if (!["hierarchy", "texture-size", "geometry"].includes(k)) throw new CliError("USAGE", `--keep accepts hierarchy, texture-size, geometry (got ${k})`, [], 2);
    const timeLimitMs = parseDuration(values["time-limit"] ?? "7m");
    const tStart = Date.now();
    const outDir = values.out ?? ".";
    const { items } = await collect(positionals);
    const models = items.filter((i) => !i.error && !i.skip);
    const amortize = values.amortize ? Math.max(1, parseInt(values.amortize, 10)) : Math.max(1, models.length);
    const render = await import("./render.mjs");
    const results = [], warnings = [], failed = [], originals = [];
    await mkdir(outDir, { recursive: true });
    for (const it of items) {
        if (it.error || it.skip) {
            failed.push({ input: rel(it.input), detail: it.skip ?? it.error.message });
            continue;
        }
        const name = path.basename(it.input, path.extname(it.input));
        try {
            const glb = await loadBytes(it.input);
            progress(`tune: ${rel(it.input)} for ${goals.join(",")} (fidelity >= ${floor} at ${view}px; whole run limited to ${values["time-limit"] ?? "7m"})`);
            // compat needs its own baseline (no instancing, no quantization), so it runs as a separate pass
            const passes = goals.includes("compat") && goals.length > 1 ? [goals.filter((g) => g !== "compat"), ["compat"]] : [goals];
            const table = [];
            for (const pass of passes) {
                const remainingInputs = models.length - models.indexOf(it);
                const budget = Math.max(30000, (timeLimitMs - (Date.now() - tStart)) / remainingInputs / passes.length);
                const t = await tune(glb, { goals: pass, floor, view, views: 4, network, amortize, timeLimitMs: budget, keep });
                for (const c of t.candidates) table.push({ candidate: c.label, bytes: c.bytes, decoders: c.decoders.join("+") || "none", gpu_mib: mib(c.gpu), load_s: s3(t.loadS(c)), fidelity: c.fidelity, within_limit: c.pass });
                for (const goal of pass) {
                    const w = t.winners[goal];
                    const recipe = normalizeRecipe({
                        recipe: 1,
                        name: `${name}.${goal}`,
                        goal,
                        stages: w.recipe.stages,
                        check: { fidelity: floor, view, views: 4 },
                        tuned: { input: rel(it.input), date: new Date().toISOString().slice(0, 10), network, amortized_over: amortize, result: { bytes: w.bytes, decoders: w.decoders.join("+") || "none", gpu_mib: mib(w.gpu), load_s: s3(t.loadS(w)), fidelity: w.fidelity } },
                    });
                    const file = path.join(outDir, `${name}.${goal}${RECIPE_EXT}`);
                    await writeRecipe(file, recipe, FORMAT);
                    await render.evaluate(w.glb);
                    const previewFile = path.join(outDir, `${name}.${goal}.preview.png`);
                    await writeFile(previewFile, await render.preview(w.worstView));
                    const st = w.recipe.stages;
                    const tex = st.textures.format === "keep" ? "original" : st.textures.format === "ktx2" ? `ktx2 ${st.textures.ktx2.color}+${st.textures.ktx2.data}` : `${st.textures.format} q${st.textures.quality}/${st.textures.dataQuality ?? st.textures.quality} (color/data maps)`;
                    results.push({
                        input: rel(it.input),
                        goal,
                        recipe: rel(file),
                        bytes: w.bytes,
                        decoder_bytes: Math.round(decoderBytes(w.decoders) / amortize),
                        gpu_mib: mib(w.gpu),
                        load_s: s3(t.loadS(w)),
                        fidelity: w.fidelity,
                        textures: `${tex} <=${st.textures.maxSize}px`,
                        geometry: `${st.geometry.mode}${st.geometry.mode === "meshopt" ? "-" + st.geometry.meshoptLevel : ""}${st.geometry.simplify < 1 ? ` simplify ${st.geometry.simplify}` : ""}`,
                        decoders: w.decoders.join("+") || "none",
                        search: t.stoppedEarly ? "partial" : "complete",
                        preview: rel(previewFile),
                    });
                    if (w.decoders.length) warnings.push(...decoderWarnings(w.decoders).map((x) => `${name}.${goal}: ${x}`));
                    if (st.textures.format === "avif") warnings.push(`${name}.${goal}: ${formatNotes({ getRoot: () => ({ listExtensionsUsed: () => [{ extensionName: "EXT_texture_avif" }] }) })[0]}`);
                }
                if (t.stoppedEarly) {
                    const mins = Math.min(9, Math.max(5, Math.ceil((t.elapsedMs / 60000) * 3))); // agent shells often kill commands after ~10 min
                    warnings.push(`${name} (${pass.join(",")}): time limit reached; not yet tried: ${t.skipped.join(", ")}. Results are the best found so far. To finish: node-assets tune ${rel(it.input)} --for ${pass.join(",")}${amortize > 1 ? ` --amortize ${amortize}` : ""} --time-limit ${mins}m -o ${outDir}`);
                }
                if (!originals.some((o) => o.input === rel(it.input))) originals.push({ input: rel(it.input), bytes: t.original.bytes, gpu_mib: mib(t.original.gpu), load_s: s3(t.original.loadS) });
            }
            const tableFile = path.join(outDir, `${name}${TABLE_EXT}`);
            await writeFile(tableFile, serialize({ input: rel(it.input), limit: `fidelity >= ${floor} at ${view}px`, candidates: table }, FORMAT));
            progress(`tune: wrote ${tableFile}`);
        } catch (e) {
            const ce = asError(e);
            failed.push({ input: rel(it.input), detail: `${ce.code}: ${ce.message}` });
        }
    }
    await render.stopRenderer();
    const res = {
        limits: { fidelity: `>= ${floor} (worst 64px-region SSIM vs original, 4 views at ${view}px)`, network: `${network} (${NETWORKS[network]} Mbps)`, decoders_amortized_over: `${amortize} asset(s)` },
        originals,
        results,
    };
    if (failed.length) res.failed = failed;
    if (warnings.length) res.warnings = [...new Set(warnings)];
    res.help = [
        `Run \`node-assets run <recipe> <input> -o <out.glb>\` to apply a recipe (add --check on other models to verify it suits them)`,
        `Every result looks the same as the original when shown at ${view}px (worst-region SSIM >= ${floor}; previews show the worst view). If the model will be shown larger or up close (VR, zoom), tune again with --view 2048; for extra margin, raise --fidelity`,
        `Edit a recipe file to mix stages from different goals, then \`run\` it; full candidate tables: ${path.join(outDir, `<name>${TABLE_EXT}`)}`,
    ];
    out(res);
    return failed.length ? 1 : 0;
}

async function cmdSetup(argv) {
    const { values } = parse("setup", argv);
    if (values.help) return out(HELP.setup()), 0;
    if (!values.hook && !values.skill) throw new CliError("USAGE", "choose what to install: --hook and/or --skill", [HELP.setup().usage], 2);
    const { readFile } = await import("node:fs/promises");
    const bin = path.resolve(process.argv[1]);
    const command = `node ${JSON.stringify(bin)} --home-compact`;
    const done = [];
    if (values.hook) {
        const file = path.join(process.cwd(), ".claude", "settings.json");
        let cfg = {};
        try {
            cfg = JSON.parse(await readFile(file, "utf8"));
        } catch {}
        cfg.hooks ??= {};
        const list = (cfg.hooks.SessionStart ??= []);
        const mine = list.flatMap((m) => m.hooks ?? []).find((h) => typeof h.command === "string" && h.command.includes("--home-compact"));
        if (mine && mine.command === command) done.push({ item: "SessionStart hook", file: rel(file), status: "already installed (no-op)" });
        else {
            if (mine) mine.command = command;
            else list.push({ hooks: [{ type: "command", command }] });
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
            done.push({ item: "SessionStart hook", file: rel(file), status: mine ? "path repaired" : "installed" });
        }
    }
    if (values.skill) {
        const file = path.join(process.cwd(), ".claude", "skills", "node-assets", "SKILL.md");
        const body = [
            "---",
            "name: node-assets",
            "description: Make 3D models (glb, gltf, fbx, obj, stl, usd) small and web-ready; tune recipes for download size, GPU memory, load speed or compatibility under a visual-fidelity limit.",
            "---",
            "",
            "# node-assets",
            "",
            ...COMMANDS.map((c) => `- \`${HELP[c]().usage}\` - ${HELP[c]().description}`),
            "",
            "Start with `node-assets` (no arguments) to see the models and recipes in the project.",
        ].join("\n");
        let prev = null;
        try {
            prev = await readFile(file, "utf8");
        } catch {}
        if (prev === body + "\n") done.push({ item: "skill", file: rel(file), status: "already installed (no-op)" });
        else {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, body + "\n");
            done.push({ item: "skill", file: rel(file), status: prev ? "updated" : "installed" });
        }
    }
    out({ setup: done, help: ["Start a new agent session in this project to see the home view as context", "Remove the entry from .claude/settings.json (or delete the skill folder) to uninstall"] });
    return 0;
}

async function home(compact = false) {
    const found = [], recipes = [];
    async function walk(dir, depth) {
        if (depth > 3 || found.length > 200) return;
        let ents = [];
        try {
            ents = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of ents) {
            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) await walk(p, depth + 1);
            else if (ALL_IN.includes(path.extname(e.name).toLowerCase())) found.push({ file: rel(p), bytes: (await stat(p)).size });
            else if (/\.recipe\.(toon|json)$/.test(e.name)) recipes.push(rel(p));
        }
    }
    await walk(process.cwd(), 0);
    found.sort((a, b) => b.bytes - a.bytes);
    const bin = process.argv[1] ? process.argv[1].replace(os.homedir(), "~") : "node-assets";
    const res = {
        bin,
        description: TUNE ? "Make 3D models small and web-ready: inspect them, tune a recipe for a goal (size, gpu, load, compat) under a fidelity limit, and run recipes" : "Make 3D models small and web-ready: inspect them and optimize them with the default recipe or lever flags",
        models: found.length ? found.slice(0, 20) : "0 models found under the current directory",
    };
    if (found.length > 20) res.count = `showing 20 of ${found.length} models (largest first)`;
    if (TUNE) res.recipes = recipes.length ? recipes : "0 recipes found";
    if (!compact) res.commands = COMMANDS.map((c) => `${c}: ${HELP[c]().usage}`);
    res.help = [`Run \`node-assets inspect <file>\` for size, GPU memory and decoders`];
    if (TUNE) res.help.push(`Run \`node-assets tune <file> --for size|gpu|load|compat -o recipes/\` to find the best settings for a goal`);
    res.help.push(`Run \`node-assets <command> --help\` for flags and examples`);
    out(res);
    return 0;
}

export async function main(argv) {
    const [cmd, ...rest] = argv;
    try {
        if (!cmd) return await home();
        if (cmd === "--help" || cmd === "-h" || cmd === "help") {
            if (rest[0] && COMMANDS.includes(rest[0])) return out(HELP[rest[0]]()), 0;
            return await home();
        }
        if (cmd === "-v" || cmd === "-V" || cmd === "--version") return out({ version: VERSION }), 0;
        if (cmd === "--home-compact") return await home(true);
        const fn = { inspect: cmdInspect, optimize: cmdOptimize, tune: TUNE && cmdTune, run: TUNE && cmdRun, setup: cmdSetup }[cmd];
        if (!fn) throw new CliError("USAGE", `unknown command "${cmd}"`, [`commands: ${COMMANDS.join(", ")}`], 2);
        return await fn(rest);
    } catch (e) {
        const ce = asError(e);
        out({ error: ce.message, code: ce.code, ...(ce.help.length ? { help: ce.help } : {}) });
        return ce.exit ?? 1;
    }
}
