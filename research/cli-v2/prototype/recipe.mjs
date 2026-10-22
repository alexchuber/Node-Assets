// Recipe schema, strict validation, TOON/JSON (de)serialization, provenance hashing.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { encode, decode } from "@toon-format/toon";
import { DEFAULT_RECIPE } from "./engine.mjs";

const bool = { t: "bool" };
const int = (min, max) => ({ t: "int", min, max });
const num = (min, max) => ({ t: "num", min, max });
const oneOf = (...v) => ({ t: "enum", v });

export const SCHEMA = {
    cleanup: { prune: bool, dedup: bool, weld: bool, metalRough: bool, instance: bool, flatten: bool, palette: bool },
    textures: {
        format: oneOf("keep", "webp", "avif", "jpeg", "png", "ktx2"),
        quality: int(1, 100),
        dataQuality: int(1, 100),
        maxSize: int(16, 16384),
        ktx2: { color: oneOf("etc1s", "uastc"), data: oneOf("etc1s", "uastc"), etc1sQuality: int(1, 255), uastcQuality: int(0, 3), zstd: bool },
    },
    geometry: {
        mode: oneOf("quantize", "meshopt", "draco", "none"),
        simplify: num(0.05, 1),
        meshoptLevel: oneOf("medium", "high"),
        dracoPosition: int(8, 16),
        dracoNormal: int(6, 14),
        dracoTexcoord: int(8, 16),
        dracoDecodeSpeed: int(0, 10),
    },
};
const TOP = ["recipe", "name", "goal", "stages", "check", "tuned"];

export class RecipeError extends Error {
    constructor(message, hint) {
        super(message);
        this.code = "BAD_RECIPE";
        this.hint = hint;
    }
}

function checkNode(value, schema, at) {
    if (schema.t) {
        const ok =
            (schema.t === "bool" && typeof value === "boolean") ||
            (schema.t === "int" && Number.isInteger(value) && value >= schema.min && value <= schema.max) ||
            (schema.t === "num" && typeof value === "number" && value >= schema.min && value <= schema.max) ||
            (schema.t === "enum" && schema.v.includes(value));
        if (!ok) {
            const want = schema.t === "enum" ? `one of ${schema.v.join("|")}` : schema.t === "bool" ? "true or false" : `${schema.t === "int" ? "an integer" : "a number"} from ${schema.min} to ${schema.max}`;
            throw new RecipeError(`${at} is ${JSON.stringify(value)}; expected ${want}`, `Fix ${at} in the recipe`);
        }
        return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RecipeError(`${at} must be an object`, `Valid keys for ${at}: ${Object.keys(schema).join(", ")}`);
    for (const k of Object.keys(value)) {
        if (!(k in schema)) throw new RecipeError(`unknown key ${at}.${k}`, `Valid keys for ${at}: ${Object.keys(schema).join(", ")}`);
        checkNode(value[k], schema[k], `${at}.${k}`);
    }
}

// Fill omitted fields from the default recipe, then validate strictly (unknown keys are errors).
export function normalizeRecipe(r) {
    if (typeof r !== "object" || r === null) throw new RecipeError("recipe is empty or not an object", "A recipe needs at least `recipe: 1` and `stages:`");
    for (const k of Object.keys(r)) if (!TOP.includes(k)) throw new RecipeError(`unknown top-level key ${k}`, `Valid top-level keys: ${TOP.join(", ")}`);
    if (r.recipe !== 1) throw new RecipeError(`recipe version is ${JSON.stringify(r.recipe)}; expected 1`, "Set `recipe: 1`");
    const d = DEFAULT_RECIPE.stages;
    const s = r.stages ?? {};
    checkNode(s, SCHEMA, "stages");
    const stages = {
        cleanup: { ...d.cleanup, ...(s.cleanup ?? {}) },
        textures: { ...d.textures, ...(s.textures ?? {}), ktx2: { ...d.textures.ktx2, ...(s.textures?.ktx2 ?? {}) } },
        geometry: { ...d.geometry, ...(s.geometry ?? {}) },
    };
    const check = r.check ? { fidelity: r.check.fidelity ?? 0.9, view: r.check.view ?? 1024, views: r.check.views ?? 4 } : undefined;
    if (check && !(check.fidelity > 0 && check.fidelity <= 1)) throw new RecipeError("check.fidelity must be between 0 and 1", "e.g. check.fidelity: 0.9");
    return { recipe: 1, name: r.name, goal: r.goal, stages, check, tuned: r.tuned };
}

export const recipeHash = (r) => createHash("sha1").update(JSON.stringify(r.stages)).digest("hex").slice(0, 12);

export function serialize(obj, format) {
    return format === "json" ? JSON.stringify(obj, null, 2) + "\n" : encode(obj) + "\n";
}

export async function readRecipe(file) {
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch {
        const e = new RecipeError(`${file}: no such recipe file`, "Create one with `node-assets tune <model> --for <goal>`");
        e.code = "INPUT_NOT_FOUND";
        throw e;
    }
    let obj;
    try {
        obj = file.endsWith(".json") || text.trimStart().startsWith("{") ? JSON.parse(text) : decode(text);
    } catch (err) {
        throw new RecipeError(`${file}: not valid ${file.endsWith(".json") ? "JSON" : "TOON"} (${String(err.message).split("\n")[0]})`, "Check indentation and `key: value` syntax");
    }
    return normalizeRecipe(obj);
}

export async function writeRecipe(file, recipe, format) {
    await writeFile(file, serialize(recipe, format));
}
