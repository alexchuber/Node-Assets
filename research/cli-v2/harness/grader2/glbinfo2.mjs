// Grader helper (independent of the CLI under test): bytes, required extensions, decoders,
// GPU memory estimate (same stated assumptions as the CLI: RGBA8 4 B/px or KTX2 1 B/px, +1/3 for mips;
// Draco-decoded attributes as float32; otherwise stored component sizes; shared accessors counted once).
import { readFile, stat } from "node:fs/promises";
import { NodeIO, Logger } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import draco3d from "draco3dgltf";
import validator from "gltf-validator";

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "draco3d.decoder": await draco3d.createDecoderModule() });
io.setLogger(new Logger(Logger.Verbosity.SILENT));
const DEC = { EXT_meshopt_compression: "meshopt", KHR_draco_mesh_compression: "draco", KHR_texture_basisu: "ktx2" };
const CB = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const EL = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const res = {};
for (const p of process.argv.slice(2)) {
    const r = (res[p] = { exists: false });
    const st = await stat(p).catch(() => null);
    if (!st) continue;
    r.exists = true;
    r.bytes = st.size;
    const bytes = new Uint8Array(await readFile(p));
    try {
        const v = await validator.validateBytes(bytes, { maxIssues: 20, ignoredIssues: ["UNSUPPORTED_EXTENSION"] });
        r.validator_errors = v.issues.numErrors;
    } catch {
        r.validator_errors = 999;
    }
    try {
        const len = new DataView(bytes.buffer).getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
        r.required = json.extensionsRequired ?? [];
        r.decoders = r.required.filter((e) => DEC[e]).map((e) => DEC[e]);
        const doc = await io.readBinary(bytes);
        const root = doc.getRoot();
        const draco = (json.extensionsUsed ?? []).includes("KHR_draco_mesh_compression");
        let tex = 0, geo = 0, maxTex = 0;
        for (const t of root.listTextures()) {
            const s = t.getSize();
            if (!s) continue;
            maxTex = Math.max(maxTex, s[0], s[1]);
            tex += s[0] * s[1] * (t.getMimeType() === "image/ktx2" ? 1 : 4) * (4 / 3);
        }
        const seen = new Set();
        for (const m of root.listMeshes())
            for (const pr of m.listPrimitives())
                for (const a of [...pr.listAttributes(), pr.getIndices()].filter(Boolean)) {
                    if (seen.has(a)) continue;
                    seen.add(a);
                    geo += a.getCount() * EL[a.getType()] * (draco && a !== pr.getIndices() ? 4 : CB[a.getComponentType()]);
                }
        r.gpu = Math.round(tex + geo);
        r.textures = root.listTextures().length;
        r.max_texture = maxTex;
        r.parse_ok = true;
    } catch (e) {
        r.parse_ok = false;
        r.error = String(e?.message ?? e).slice(0, 120);
    }
}
process.stdout.write(JSON.stringify(res));
