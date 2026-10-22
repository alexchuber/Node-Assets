// Deterministic load-time model: download time on the chosen network plus an estimated parse/decode time.
// Decode cost is a linear model of what the file contains (geometry bytes per codec, decoder start-up, image
// megapixels per format), fitted to cold loads in headless Chromium on a quiet machine (calib_load.mjs).
// A model rather than a live measurement, so tune ranks candidates the same way on a busy or a quiet machine
// and a recipe re-tuned on another day picks the same winner.
import { ImageUtils } from "@gltf-transform/core";

export function features(doc, totalBytes) {
    const root = doc.getRoot();
    const used = new Set(root.listExtensionsUsed().map((e) => e.extensionName));
    const f = { mb: totalBytes / 1e6, draco: +used.has("KHR_draco_mesh_compression"), meshopt: +used.has("EXT_meshopt_compression"), ktx2: +used.has("KHR_texture_basisu"), mp_avif: 0, mp_webp: 0, mp_jpeg: 0, mp_png: 0, mp_ktx2: 0 };
    let imgBytes = 0;
    for (const t of root.listTextures()) {
        const img = t.getImage();
        if (!img) continue;
        imgBytes += img.byteLength;
        const mime = t.getMimeType();
        const size = ImageUtils.getSize(img, mime) ?? [0, 0];
        const k = { "image/avif": "mp_avif", "image/webp": "mp_webp", "image/jpeg": "mp_jpeg", "image/png": "mp_png", "image/ktx2": "mp_ktx2" }[mime];
        if (k) f[k] += (size[0] * size[1]) / 1e6;
    }
    const geoMB = Math.max(0, totalBytes - imgBytes) / 1e6;
    f.draco_mb = f.draco ? geoMB : 0;
    f.meshopt_mb = f.meshopt ? geoMB : 0;
    f.plain_mb = !f.draco && !f.meshopt ? geoMB : 0;
    return f;
}

// Coefficients in ms, fitted by fit_load.py (see COEF_SOURCE). Keys match features().
// Fitted on 64 variants of 4 models (cold loads, median of 5, idle 2-CPU machine): R2 0.965, mean error 11 ms;
// leave-one-model-out rank correlation 0.88-0.97. Decoder start-up dominates small files: KTX2 ~270 ms, Draco ~40 ms.
export const COEF = { c0: 38.28, draco: 39.84, meshopt: 0.0, ktx2: 271.48, draco_mb: 180.93, meshopt_mb: 19.58, plain_mb: 7.53, mp_avif: 9.0, mp_webp: 8.77, mp_jpeg: 8.41, mp_png: 13.27, mp_ktx2: 22.03 };
export const COEF_SOURCE = "calib_load.json (headless Chromium, SwiftShader, 2 CPUs)";

export function decodeMs(f) {
    let ms = COEF.c0;
    for (const [k, v] of Object.entries(COEF)) if (k !== "c0") ms += v * (f[k] ?? 0);
    return Math.max(0, ms);
}
