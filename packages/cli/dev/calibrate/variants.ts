import type { SerializedGraph } from "@babylonjs/node-assets";

import { readDocAsync } from "../../src/document";
import { executeGraphAsync } from "../../src/execution";
import { instantiateGraph } from "../../src/graphFiles";

export interface Variant {
    readonly tex: "keep" | "webp" | "avif" | "ktx2" | "png" | "jpeg";
    readonly size: number;
    readonly geo: "quantize" | "meshopt" | "draco" | "none";
}

export function calibrationVariants(): Variant[] {
    const textures: Pick<Variant, "tex" | "size">[] = [
        { tex: "keep", size: 1024 },
        { tex: "webp", size: 1024 },
        { tex: "avif", size: 1024 },
        { tex: "ktx2", size: 1024 },
        { tex: "keep", size: 256 },
        { tex: "webp", size: 256 },
        { tex: "avif", size: 256 },
        { tex: "ktx2", size: 256 },
        { tex: "png", size: 512 },
        { tex: "jpeg", size: 2048 },
    ];
    const geometry: Variant["geo"][] = ["quantize", "meshopt", "draco", "none"];
    const variants: Variant[] = [
        ...textures.map((texture) => ({ ...texture, geo: "quantize" as const })),
        ...geometry.map((geo) => ({ tex: "webp" as const, size: 256, geo })),
        ...geometry.slice(1, 3).map((geo) => ({ tex: "avif" as const, size: 1024, geo })),
    ];
    // The three-variant smoke limit exercises every real decoder, not just image formats.
    const first = [7, 11, 15];
    return [...first.map((index) => variants[index]!), ...variants.filter((_, index) => !first.includes(index))];
}

export function variantGraph(variant: Variant): SerializedGraph {
    const blocks: SerializedGraph["blocks"][number][] = [
        { type: "transform.metal-rough" },
        { type: "transform.dedup" },
        { type: "transform.cull-unused" },
        { type: "transform.weld" },
        { type: "transform.flatten" },
        { type: "transform.resize-textures", config: { maxSize: variant.size, slots: "all" } },
    ];
    if (variant.tex === "ktx2") {
        blocks.push({ type: "transform.encode-ktx2", config: { mode: "auto", slots: "all" } });
    } else if (variant.tex !== "keep") {
        blocks.push({ type: "transform.encode-textures", config: { format: variant.tex, quality: variant.tex === "avif" ? 60 : 80, slots: "all" } });
    }
    blocks.push({ type: "transform.cull-unused" });
    if (variant.geo === "quantize") blocks.push({ type: "transform.quantize" });
    if (variant.geo === "meshopt") blocks.push({ type: "transform.encode-meshopt", config: { level: "high" } });
    if (variant.geo === "draco") blocks.push({ type: "transform.encode-draco" });
    return { graph: 1, blocks };
}

export async function executeVariantAsync(original: Uint8Array, variant: Variant): Promise<Uint8Array> {
    const document = await readDocAsync(original);
    document.disposeExtension("KHR_draco_mesh_compression");
    document.disposeExtension("EXT_meshopt_compression");
    return executeGraphAsync(instantiateGraph(variantGraph(variant)), document);
}
