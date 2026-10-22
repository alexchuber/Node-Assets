// Measurements that need no rendering: bytes, decoder bytes, GPU memory estimate, compatibility, validation.
import validator from "gltf-validator";

// gzip sizes of the decoders a web viewer must download (three.js r180 builds, measured).
export const DECODERS = {
    EXT_meshopt_compression: { name: "meshopt", bytes: 6455, three: "loader.setMeshoptDecoder(MeshoptDecoder)" },
    KHR_draco_mesh_compression: { name: "draco", bytes: 63240 + 11524, three: "loader.setDRACOLoader(new DRACOLoader().setDecoderPath(...))" },
    KHR_texture_basisu: { name: "ktx2", bytes: 245408 + 15060, three: "loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(...).detectSupport(renderer))" },
};
// Network presets in megabits per second.
export const NETWORKS = { "slow-4g": 1.6, "4g": 9, wifi: 30 };

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_ELEMENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// Estimate of what the scene occupies in GPU memory once loaded (textures with mips + vertex/index buffers).
// Assumptions: PNG/JPEG/WebP/AVIF decode to RGBA8 (4 B/px); KTX2 transcodes to a 1 B/px block format
// (ASTC 4x4 / BC7); Draco decodes to float32 attributes; quantized/meshopt data stays in its stored type.
export function gpuEstimate(doc) {
    const root = doc.getRoot();
    const draco = root.listExtensionsUsed().some((e) => e.extensionName === "KHR_draco_mesh_compression");
    let tex = 0;
    for (const t of root.listTextures()) {
        let s = null;
        try {
            s = t.getSize();
        } catch {}
        if (!s) continue;
        const bpp = t.getMimeType() === "image/ktx2" ? 1 : 4;
        tex += s[0] * s[1] * bpp * (4 / 3);
    }
    const seen = new Set();
    let geo = 0;
    for (const m of root.listMeshes())
        for (const p of m.listPrimitives()) {
            for (const a of [...p.listAttributes(), p.getIndices()].filter(Boolean)) {
                if (seen.has(a)) continue;
                seen.add(a);
                const isIndex = a === p.getIndices();
                const comp = draco && !isIndex ? 4 : COMPONENT_BYTES[a.getComponentType()] ?? 4;
                geo += a.getCount() * (TYPE_ELEMENTS[a.getType()] ?? 1) * comp;
            }
        }
    return { textures: Math.round(tex), geometry: Math.round(geo), total: Math.round(tex + geo) };
}

export function extensionsOf(doc) {
    const root = doc.getRoot();
    const required = root.listExtensionsRequired().map((e) => e.extensionName);
    const decoders = required.filter((e) => DECODERS[e]).map((e) => DECODERS[e].name);
    return { required, decoders };
}

export function decoderBytes(names) {
    return names.reduce((a, n) => a + (Object.values(DECODERS).find((d) => d.name === n)?.bytes ?? 0), 0);
}

export function docSummary(doc) {
    const root = doc.getRoot();
    let tris = 0, verts = 0, texBytes = 0;
    for (const m of root.listMeshes())
        for (const p of m.listPrimitives()) {
            const pos = p.getAttribute("POSITION");
            verts += pos ? pos.getCount() : 0;
            if (p.getMode() === 4) tris += (p.getIndices()?.getCount() ?? pos?.getCount() ?? 0) / 3;
        }
    const textures = root.listTextures().map((t) => {
        let s = null;
        try {
            s = t.getSize();
        } catch {}
        texBytes += t.getImage()?.byteLength ?? 0;
        return { mime: t.getMimeType().replace("image/", ""), w: s?.[0] ?? 0, h: s?.[1] ?? 0 };
    });
    const groups = new Map();
    for (const t of textures) groups.set(`${t.mime} ${t.w}x${t.h}`, (groups.get(`${t.mime} ${t.w}x${t.h}`) ?? 0) + 1);
    return {
        triangles: Math.round(tris),
        vertices: verts,
        textureBytes: texBytes,
        textures: [...groups].map(([k, n]) => `${n}x ${k}`).join(", ") || "none",
        maxTexture: Math.max(0, ...textures.map((t) => Math.max(t.w, t.h))),
        meshes: root.listMeshes().length,
        materials: root.listMaterials().length,
        animations: root.listAnimations().length,
        nodes: root.listNodes().length,
    };
}

export async function validate(bytes) {
    try {
        const r = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 200, ignoredIssues: ["UNSUPPORTED_EXTENSION"] });
        const codes = [...new Set(r.issues.messages.filter((m) => m.severity === 0).map((m) => m.code))];
        return { errors: r.issues.numErrors, codes };
    } catch (e) {
        return { errors: 1, codes: ["UNREADABLE"] };
    }
}
