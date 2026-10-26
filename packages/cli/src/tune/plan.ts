import type { TuneStages } from "./stages";

export type Goal = "size" | "gpu" | "load" | "compat";
export const GOALS: readonly Goal[] = ["size", "gpu", "load", "compat"];

interface TextureFamily {
    readonly format: TuneStages["textures"]["format"];
    readonly q?: boolean;
    readonly ktx2?: Partial<TuneStages["textures"]["ktx2"]>;
}

export const LEVELS = [30, 40, 50, 60, 70, 80, 90];
export const SIZES = [256, 512, 768, 1024, 1536, 2048, 3072, 4096];
export const SIMPLIFY_LEVELS = [0.25, 0.5, 0.75];
export const TEXFAM: Record<string, TextureFamily> = {
    avif: { format: "avif", q: true },
    webp: { format: "webp", q: true },
    jpeg: { format: "jpeg", q: true },
    png: { format: "png" },
    "ktx2 etc1s+uastc": { format: "ktx2", ktx2: { color: "etc1s", data: "uastc" } },
    "ktx2 uastc": { format: "ktx2", ktx2: { color: "uastc", data: "uastc" } },
    "ktx2 etc1s": { format: "ktx2", ktx2: { color: "etc1s", data: "etc1s" } },
};
export const GEOM: Record<string, Partial<TuneStages["geometry"]>> = {
    quantize: { mode: "quantize" },
    meshopt: { mode: "meshopt", meshoptLevel: "medium" },
    "meshopt-high": { mode: "meshopt", meshoptLevel: "high" },
    draco: { mode: "draco", dracoPosition: 14, dracoNormal: 10, dracoTexcoord: 12 },
    "draco-low": { mode: "draco", dracoPosition: 11, dracoNormal: 8, dracoTexcoord: 10 },
    none: { mode: "none" },
};
export const PLAN: Record<Goal, { tex: [string[], string[]]; geo: [string[], string[]] }> = {
    size: { tex: [["avif"], ["webp"]], geo: [["draco", "meshopt-high"], ["draco-low"]] },
    load: { tex: [["avif"], ["webp"]], geo: [["meshopt-high", "draco"], ["meshopt"]] },
    gpu: { tex: [["ktx2 etc1s+uastc"], ["ktx2 uastc", "ktx2 etc1s"]], geo: [["meshopt"], []] },
    compat: { tex: [["jpeg"], ["png"]], geo: [["none"], []] },
};
export const TEXEXT = ["EXT_texture_webp", "EXT_texture_avif", "KHR_texture_basisu"];
export const GEOEXT = ["KHR_mesh_quantization", "EXT_meshopt_compression", "KHR_draco_mesh_compression"];
