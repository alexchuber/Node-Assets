import { ImageUtils, type Document } from "@gltf-transform/core";

import calibration from "./loadModel.coefficients.json";

export interface LoadFeatures {
    readonly [feature: string]: number;
}

export function features(doc: Document, totalBytes: number): LoadFeatures {
    const root = doc.getRoot();
    const used = new Set(root.listExtensionsUsed().map((extension) => extension.extensionName));
    const result: Record<string, number> = {
        mb: totalBytes / 1e6,
        draco: +used.has("KHR_draco_mesh_compression"),
        meshopt: +used.has("EXT_meshopt_compression"),
        ktx2: +used.has("KHR_texture_basisu"),
        mp_avif: 0,
        mp_webp: 0,
        mp_jpeg: 0,
        mp_png: 0,
        mp_ktx2: 0,
    };
    let imageBytes = 0;
    for (const texture of root.listTextures()) {
        const image = texture.getImage();
        if (!image) continue;
        imageBytes += image.byteLength;
        const mime = texture.getMimeType();
        const size = ImageUtils.getSize(image, mime) ?? [0, 0];
        const key = ({ "image/avif": "mp_avif", "image/webp": "mp_webp", "image/jpeg": "mp_jpeg", "image/png": "mp_png", "image/ktx2": "mp_ktx2" } as Record<string, string>)[mime];
        if (key) result[key] = (result[key] ?? 0) + (size[0]! * size[1]!) / 1e6;
    }
    const geometryMB = Math.max(0, totalBytes - imageBytes) / 1e6;
    result.draco_mb = result.draco ? geometryMB : 0;
    result.meshopt_mb = result.meshopt ? geometryMB : 0;
    result.plain_mb = !result.draco && !result.meshopt ? geometryMB : 0;
    return result;
}

export const COEF = calibration.coefficients;
export const COEF_SOURCE = calibration.source;

export function decodeMs(value: LoadFeatures): number {
    let ms = COEF.c0;
    for (const [key, coefficient] of Object.entries(COEF)) if (key !== "c0") ms += coefficient * (value[key] ?? 0);
    return Math.max(0, ms);
}
