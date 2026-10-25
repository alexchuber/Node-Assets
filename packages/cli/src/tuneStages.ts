import type { SerializedBlock, SerializedGraph } from "@babylonjs/node-assets";

export interface TuneStages {
    readonly cleanup: { readonly flatten: boolean; readonly instance: boolean };
    readonly textures: {
        readonly format: "keep" | "webp" | "avif" | "jpeg" | "png" | "ktx2";
        readonly maxSize: number;
        readonly quality: number;
        readonly dataQuality: number;
        readonly ktx2: {
            readonly color: "etc1s" | "uastc";
            readonly data: "etc1s" | "uastc";
            readonly etc1sQuality: number;
            readonly uastcQuality: number;
            readonly zstd: boolean;
        };
    };
    readonly geometry: {
        readonly mode: "none" | "quantize" | "meshopt" | "draco";
        readonly simplify: number;
        readonly meshoptLevel: "medium" | "high";
        readonly dracoPosition: number;
        readonly dracoNormal: number;
        readonly dracoTexcoord: number;
        readonly dracoDecodeSpeed: number;
    };
}

export type StagePatch = {
    readonly cleanup?: Partial<TuneStages["cleanup"]>;
    readonly textures?: Partial<Omit<TuneStages["textures"], "ktx2">> & { readonly ktx2?: Partial<TuneStages["textures"]["ktx2"]> };
    readonly geometry?: Partial<TuneStages["geometry"]>;
};

export function initialStages(summary: { maxTexture: number; animations: number }, keep: ReadonlySet<string>, compatOnly: boolean): TuneStages {
    return {
        cleanup: { flatten: summary.animations === 0 && !keep.has("hierarchy"), instance: !keep.has("hierarchy") && !compatOnly },
        textures: {
            format: "keep",
            maxSize: Math.max(summary.maxTexture, 16),
            quality: 90,
            dataQuality: 95,
            ktx2: { color: "etc1s", data: "uastc", etc1sQuality: 128, uastcQuality: 1, zstd: true },
        },
        geometry: { mode: compatOnly ? "none" : "quantize", simplify: 1, meshoptLevel: "medium", dracoPosition: 14, dracoNormal: 10, dracoTexcoord: 12, dracoDecodeSpeed: 5 },
    };
}

export function withStages(base: TuneStages, patch: StagePatch): TuneStages {
    return {
        cleanup: { ...base.cleanup, ...patch.cleanup },
        textures: { ...base.textures, ...patch.textures, ktx2: { ...base.textures.ktx2, ...patch.textures?.ktx2 } },
        geometry: { ...base.geometry, ...patch.geometry },
    };
}

export function stageBlocks(stages: TuneStages, originalMaxTexture: number): { cleanup: SerializedBlock[]; textures: SerializedBlock[]; geometry: SerializedBlock[] } {
    const cleanup: SerializedBlock[] = [{ type: "transform.metal-rough" }, { type: "transform.dedup" }, { type: "transform.cull-unused" }, { type: "transform.weld" }];
    if (stages.cleanup.flatten) cleanup.push({ type: "transform.flatten" });
    if (stages.cleanup.instance) cleanup.push({ type: "transform.instance", config: { min: 2 } });
    const textures: SerializedBlock[] = [];
    const t = stages.textures;
    if (t.maxSize < originalMaxTexture) textures.push({ type: "transform.resize-textures", config: { maxSize: t.maxSize, slots: "all" } });
    if (t.format === "ktx2") {
        textures.push({
            type: "transform.encode-ktx2",
            config: {
                mode: t.ktx2.color === t.ktx2.data ? t.ktx2.color : "auto",
                slots: "all",
                etc1sQuality: t.ktx2.etc1sQuality,
                uastcQuality: t.ktx2.uastcQuality,
                zstd: t.ktx2.zstd,
            },
        });
    } else if (t.format !== "keep") {
        const quality = (q: number) => (t.format === "avif" ? Math.round(q * 0.7) : q);
        textures.push(
            { type: "transform.encode-textures", config: { format: t.format, quality: quality(t.quality), slots: "color" } },
            { type: "transform.encode-textures", config: { format: t.format, quality: quality(t.dataQuality), slots: "data" } }
        );
    }
    const geometry: SerializedBlock[] = [];
    const g = stages.geometry;
    if (g.simplify < 1) geometry.push({ type: "transform.simplify", config: { ratio: g.simplify, error: 0.002 } });
    switch (g.mode) {
        case "none":
            geometry.push({ type: "transform.dequantize" });
            break;
        case "quantize":
            geometry.push({ type: "transform.quantize" });
            break;
        case "meshopt":
            geometry.push({ type: "transform.encode-meshopt", config: { level: g.meshoptLevel } });
            break;
        case "draco":
            geometry.push({
                type: "transform.encode-draco",
                config: {
                    quantizePosition: g.dracoPosition,
                    quantizeNormal: g.dracoNormal,
                    quantizeTexcoord: g.dracoTexcoord,
                    decodeSpeed: g.dracoDecodeSpeed,
                    encodeSpeed: 5,
                    method: "edgebreaker",
                },
            });
    }
    geometry.push({ type: "transform.cull-unused" });
    return { cleanup, textures, geometry };
}

export function compileStages(stages: TuneStages, originalMaxTexture: number): SerializedGraph {
    const blocks = stageBlocks(stages, originalMaxTexture);
    return { graph: 1, blocks: [...blocks.cleanup, ...blocks.textures, ...blocks.geometry] };
}
