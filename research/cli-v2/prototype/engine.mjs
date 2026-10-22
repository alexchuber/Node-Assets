// Processing engine: load inputs, apply recipe stages, write GLB. No CLI concerns here.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { NodeIO, Logger } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTTextureWebP, EXTTextureAVIF } from "@gltf-transform/extensions";
import { dedup, prune, weld, instance, flatten, palette, metalRough, reorder, quantize, meshopt, draco, simplify, listTextureSlots } from "@gltf-transform/functions";
import sharp from "sharp";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";

// FBX/OBJ/STL/USD conversion uses this repo's @babylonjs/node-assets build (pnpm build). NA_CORE overrides the path.
const CORE = process.env.NA_CORE ?? new URL("../../../packages/core/dist/index.js", import.meta.url).href;
export const GLTF_EXT = [".glb", ".gltf"];
export const CONVERT_EXT = [".fbx", ".obj", ".stl", ".usd", ".usda", ".usdc", ".usdz"];
export const ALL_IN = [...GLTF_EXT, ...CONVERT_EXT];

export class EngineError extends Error {
    constructor(code, message, hint) {
        super(message);
        this.code = code;
        this.hint = hint;
    }
}

const SILENT = new Logger(Logger.Verbosity.SILENT);
let ioPromise;
export function getIO() {
    return (ioPromise ??= (async () => {
        await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
        const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
            "meshopt.encoder": MeshoptEncoder,
            "meshopt.decoder": MeshoptDecoder,
            "draco3d.encoder": await draco3d.createEncoderModule(),
            "draco3d.decoder": await draco3d.createDecoderModule(),
        });
        io.setLogger(SILENT);
        return io;
    })());
}

// Reference-counted so concurrent encodes can't leave the console muted.
let muteDepth = 0, savedConsole;
function mute() {
    if (muteDepth++ === 0) {
        savedConsole = { log: console.log, warn: console.warn, info: console.info, error: console.error, debug: console.debug };
        for (const k of Object.keys(savedConsole)) console[k] = () => {};
    }
    let done = false;
    return () => {
        if (done) return;
        done = true;
        if (--muteDepth === 0) Object.assign(console, savedConsole);
    };
}
const shortMsg = (m) => String(m).split("\n")[0].replace(/file:\/\/\S+/g, "").slice(0, 160);

const EXPORT_HINT = {
    ".blend": "Export it from Blender as .glb (File > Export > glTF 2.0) or .fbx first.",
    ".max": "Export it from 3ds Max as .fbx or .glb first.",
    ".ma": "Export it from Maya as .fbx or .glb first.",
    ".mb": "Export it from Maya as .fbx or .glb first.",
    ".c4d": "Export it from Cinema 4D as .fbx or .glb first.",
    ".dae": "Convert COLLADA to .glb or .fbx first (e.g. in Blender).",
};
export const unsupportedHint = (ext) => EXPORT_HINT[ext] ?? `Supported inputs: ${ALL_IN.join(" ")}`;

// Load any supported input as a glTF-Transform Document. Converted formats go through the repo's Babylon blocks.
const loadCache = new Map();
export async function loadBytes(file) {
    const ext = path.extname(file).toLowerCase();
    if (!ALL_IN.includes(ext)) throw new EngineError("UNSUPPORTED_FORMAT", `${file}: ${ext || "(no extension)"} is not a supported input`, unsupportedHint(ext));
    const st = await stat(file).catch(() => null);
    if (!st) throw new EngineError("INPUT_NOT_FOUND", `${file}: no such file`, `Paths are relative to ${process.cwd()}`);
    const key = `${path.resolve(file)}:${st.mtimeMs}:${st.size}`;
    if (loadCache.has(key)) return loadCache.get(key);
    const io = await getIO();
    let glb;
    if (GLTF_EXT.includes(ext)) {
        const restore = mute();
        try {
            if (ext === ".glb") {
                // Use the file exactly as stored (a decode/re-encode round trip would re-compress Draco data).
                const raw = new Uint8Array(await readFile(file));
                await io.readBinary(raw); // validates that it parses
                glb = raw;
            } else {
                glb = await io.writeBinary(await io.read(file)); // .gltf + external resources -> one GLB
            }
        } catch (e) {
            throw new EngineError("INVALID_INPUT", `${file}: not a valid ${ext === ".glb" ? "GLB" : "glTF"} file (${shortMsg(e?.message ?? e)})`, "The file is corrupt or truncated; re-export or re-download it");
        } finally {
            restore();
        }
    } else {
        const restore = mute();
        try {
            const lib = await import(CORE);
            const Block = { ".fbx": lib.FbxInputBlock, ".obj": lib.ObjInputBlock, ".stl": lib.StlInputBlock }[ext] ?? lib.UsdInputBlock;
            const src = new Block({ input: path.resolve(file) });
            const out = new lib.GltfOutputBlock();
            src.output.connectTo(out.input);
            const asset = new lib.NodeAsset({ name: "convert", outputBlock: out });
            try {
                glb = new Uint8Array(await (await asset.executeAsync()).arrayBuffer());
            } finally {
                asset.dispose();
            }
        } catch (e) {
            const msg = String(e?.message ?? e);
            let hint = "The file may be corrupt or use unsupported features; re-export it as .glb or .fbx";
            if (ext === ".obj" && /mtl/i.test(msg)) hint = "The .mtl file referenced by the OBJ was not found; place it and its textures next to the .obj";
            if (/Worker/i.test(msg)) hint = "USD input needs Web Worker support: NODE_OPTIONS=--experimental-web-worker (Node 26+)";
            throw new EngineError("INVALID_INPUT", `${file}: conversion from ${ext} failed (${shortMsg(msg)})`, hint);
        } finally {
            restore();
        }
    }
    loadCache.set(key, glb);
    return glb;
}

export async function readDoc(glb) {
    const io = await getIO();
    const doc = await io.readBinary(glb);
    doc.setLogger(SILENT);
    return doc;
}

export async function writeGlb(doc) {
    const io = await getIO();
    return io.writeBinary(doc);
}

// Bytes the input occupies on disk including referenced resources (.gltf buffers/images, .obj .mtl/textures).
export async function inputBytes(file) {
    const ext = path.extname(file).toLowerCase();
    const dir = path.dirname(file);
    const size = async (p) => (await stat(p).catch(() => ({ size: 0 }))).size;
    let total = await size(file);
    try {
        if (ext === ".gltf") {
            const json = JSON.parse(await readFile(file, "utf8"));
            for (const u of [...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x.uri).filter((u) => u && !u.startsWith("data:"))) total += await size(path.join(dir, decodeURIComponent(u)));
        } else if (ext === ".obj") {
            const text = await readFile(file, "utf8");
            for (const m of text.matchAll(/^mtllib\s+(.+)$/gm)) {
                const mtl = path.join(dir, m[1].trim());
                total += await size(mtl);
                const mtlText = await readFile(mtl, "utf8").catch(() => "");
                for (const t of new Set([...mtlText.matchAll(/^\s*map_\w+\s+(.+)$/gm)].map((x) => x[1].trim()))) total += await size(path.join(dir, t));
            }
        }
    } catch {
        /* best effort */
    }
    return total;
}

// ---------------- recipe stages ----------------
export const DEFAULT_RECIPE = Object.freeze({
    recipe: 1,
    stages: {
        cleanup: { prune: true, dedup: true, weld: true, metalRough: true, instance: false, flatten: false, palette: false },
        textures: { format: "webp", quality: 90, dataQuality: 95, maxSize: 2048, ktx2: { color: "etc1s", data: "uastc", etc1sQuality: 128, uastcQuality: 1, zstd: true } },
        geometry: { mode: "quantize", simplify: 1, meshoptLevel: "medium", dracoPosition: 14, dracoNormal: 10, dracoTexcoord: 12, dracoDecodeSpeed: 5 },
    },
});

const hasAnimation = (doc) => doc.getRoot().listAnimations().length > 0 || doc.getRoot().listSkins().length > 0;

async function applyCleanup(doc, c) {
    const t = [];
    if (c.metalRough && doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "KHR_materials_pbrSpecularGlossiness")) t.push(metalRough());
    if (c.dedup) t.push(dedup());
    if (c.prune) t.push(prune());
    if (c.weld) t.push(weld());
    if (c.flatten && !hasAnimation(doc)) t.push(flatten());
    if (c.instance) t.push(instance({ min: 2 }));
    if (c.palette) t.push(palette({ min: 2 }));
    if (t.length) await doc.transform(...t);
}

// --- texture stage, with a cache keyed by (image hash, settings) so a search never encodes the same texture twice ---
const texCache = new Map();
const hash = (u8) => createHash("sha1").update(u8).digest("hex");
const isDataSlot = (slots) => !slots.some((s) => /color|emissive|diffuse/i.test(s));
const isNormalSlot = (slots) => slots.some((s) => /normal/i.test(s));
let ktx2Mod;

async function encodeOne(img, mime, slots, t) {
    const data = isDataSlot(slots);
    const normal = isNormalSlot(slots);
    const meta = await sharp(img).metadata();
    const w = meta.width, h = meta.height;
    const scale = Math.min(1, t.maxSize / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
    const resized = scale < 1;
    // Key on the settings that affect THIS texture only, so changing data-map quality reuses the color-map encodes.
    const kmode = data ? t.ktx2.data : t.ktx2.color;
    const eff = t.format === "ktx2" ? [tw, th, kmode, kmode === "uastc" ? `${t.ktx2.uastcQuality}/${t.ktx2.zstd}` : t.ktx2.etc1sQuality] : [tw, th, t.format === "keep" || t.format === "png" ? "" : data ? t.dataQuality ?? t.quality : t.quality];
    const key = `${hash(img)}|${t.format}|${eff.join("|")}|${data}|${normal}`;
    if (texCache.has(key)) return texCache.get(key);
    let out;
    const base = () => {
        let s = sharp(img);
        if (resized) s = s.resize(tw, th, { kernel: "lanczos3" });
        return s;
    };
    const hasAlpha = meta.hasAlpha && (await sharp(img).stats()).channels[3]?.min < 255;
    const q = data ? t.dataQuality ?? t.quality : t.quality;
    if (t.format === "keep") {
        out = resized ? { img: await (mime === "image/jpeg" ? base().jpeg({ quality: 90 }) : base().png()).toBuffer(), mime: mime === "image/jpeg" ? "image/jpeg" : "image/png" } : { img, mime };
    } else if (t.format === "webp") {
        out = { img: await base().webp({ quality: q, effort: 4 }).toBuffer(), mime: "image/webp" };
    } else if (t.format === "avif") {
        out = { img: await base().avif({ quality: Math.round(q * 0.7), effort: 3 }).toBuffer(), mime: "image/avif" };
    } else if (t.format === "jpeg") {
        out = hasAlpha ? { img: await base().png({ compressionLevel: 9 }).toBuffer(), mime: "image/png" } : { img: await base().jpeg({ quality: q, mozjpeg: true }).toBuffer(), mime: "image/jpeg" };
    } else if (t.format === "png") {
        out = { img: await base().png({ compressionLevel: 9, palette: false }).toBuffer(), mime: "image/png" };
    } else if (t.format === "ktx2") {
        ktx2Mod ??= await import("babylonpress-ktx2-encoder");
        const { data: raw, info } = await base().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const mode = data ? t.ktx2.data : t.ktx2.color;
        const uastc = mode === "uastc";
        const restore = mute();
        // The encoder awaits work that does not hold the event loop open; keep it alive or Node may exit mid-encode.
        const keepAlive = setInterval(() => {}, 1000);
        try {
            const enc = await ktx2Mod.encodeToKTX2(new Uint8Array(), {
                imageDecoder: async () => ({ width: info.width, height: info.height, data: new Uint8Array(raw) }),
                isPerceptual: !data,
                isSetKTX2SRGBTransferFunc: !data,
                isNormalMap: normal,
                generateMipmap: true,
                isKTX2File: true,
                isUASTC: uastc,
                ...(uastc ? { needSupercompression: t.ktx2.zstd, uastcLDRQualityLevel: t.ktx2.uastcQuality } : { qualityLevel: t.ktx2.etc1sQuality, compressionLevel: 2 }),
            });
            out = { img: new Uint8Array(enc), mime: "image/ktx2" };
        } finally {
            clearInterval(keepAlive);
            restore();
        }
    } else throw new EngineError("BAD_RECIPE", `unknown texture format "${t.format}"`, "Use keep, webp, avif, jpeg, png or ktx2");
    // Never make a texture bigger unless we had to resize or change to a GPU format.
    if (!resized && t.format !== "ktx2" && out.img.byteLength >= img.byteLength && ["image/png", "image/jpeg", "image/webp", "image/avif"].includes(mime)) out = { img, mime };
    out = { ...out, w: tw, h: th };
    texCache.set(key, out);
    return out;
}

async function applyTextures(doc, t) {
    const root = doc.getRoot();
    await Promise.all(
        root.listTextures().map(async (tex) => {
            const img = tex.getImage();
            const mime = tex.getMimeType();
            if (!img || !["image/png", "image/jpeg", "image/webp", "image/avif"].includes(mime)) return;
            const r = await encodeOne(img, mime, listTextureSlots(tex), t);
            tex.setImage(r.img).setMimeType(r.mime);
            const uri = tex.getURI();
            if (uri) tex.setURI(uri.replace(/\.[a-z0-9]+$/i, "." + r.mime.split("/")[1]));
        })
    );
    const mimes = new Set(root.listTextures().map((x) => x.getMimeType()));
    const ensure = (Ext, needed) => {
        const existing = root.listExtensionsUsed().find((e) => e.extensionName === Ext.EXTENSION_NAME);
        if (needed && !existing) doc.createExtension(Ext).setRequired(true);
        if (!needed && existing) existing.dispose();
    };
    ensure(EXTTextureWebP, mimes.has("image/webp"));
    ensure(EXTTextureAVIF, mimes.has("image/avif"));
    ensure(KHRTextureBasisu, mimes.has("image/ktx2"));
}

async function applyGeometry(doc, g) {
    if (g.simplify < 1) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: g.simplify, error: 0.002 }));
    if (g.mode === "meshopt") await doc.transform(reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: g.meshoptLevel }));
    else if (g.mode === "draco")
        await doc.transform(
            draco({ method: "edgebreaker", decodeSpeed: g.dracoDecodeSpeed, encodeSpeed: 5, quantizePosition: g.dracoPosition, quantizeNormal: g.dracoNormal, quantizeTexcoord: g.dracoTexcoord })
        );
    else if (g.mode === "quantize") await doc.transform(quantize());
    else if (g.mode !== "none") throw new EngineError("BAD_RECIPE", `unknown geometry mode "${g.mode}"`, "Use quantize, meshopt, draco or none");
    await doc.transform(prune());
}

// Apply a recipe to an input's GLB bytes; returns output GLB bytes plus the document.
export async function applyRecipe(glb, recipe, provenance) {
    const doc = await readDoc(glb);
    const s = recipe.stages;
    await applyCleanup(doc, s.cleanup);
    await applyTextures(doc, s.textures);
    await applyGeometry(doc, s.geometry);
    if (provenance) doc.getRoot().setExtras({ ...doc.getRoot().getExtras(), nodeAssets: provenance });
    const bytes = await writeGlb(doc);
    return { bytes, doc };
}

export const sha = (u8) => createHash("sha1").update(u8).digest("hex").slice(0, 12);

// Read root extras.nodeAssets from a GLB without decoding it (for idempotent re-runs).
export async function readProvenance(file) {
    try {
        const b = await readFile(file);
        if (b.readUInt32LE(0) !== 0x46546c67) return null;
        const len = b.readUInt32LE(12);
        return JSON.parse(b.subarray(20, 20 + len).toString("utf8")).extras?.nodeAssets ?? null;
    } catch {
        return null;
    }
}
