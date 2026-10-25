import type { Accessor, Document } from "@gltf-transform/core";
import validator from "gltf-validator";

import { decodeMs, features } from "./loadModel";

export const DECODERS = {
    KHR_draco_mesh_compression: { name: "draco", bytes: 74865 },
    EXT_meshopt_compression: { name: "meshopt", bytes: 6694 },
    KHR_texture_basisu: { name: "ktx2", bytes: 264668 },
} as const;

export const NETWORKS = { "slow-4g": 1.6, "4g": 9, wifi: 30 } as const;
export type Network = keyof typeof NETWORKS;

export function gpuEstimate(doc: Document): { textures: number; geometry: number; total: number } {
    const root = doc.getRoot();
    const draco = root.listExtensionsUsed().some((extension) => extension.extensionName === "KHR_draco_mesh_compression");
    let textures = 0;
    for (const texture of root.listTextures()) {
        const size = texture.getSize();
        if (size) textures += size[0] * size[1] * (texture.getMimeType() === "image/ktx2" ? 1 : 4) * (4 / 3);
    }
    const seen = new Set<Accessor>();
    let geometry = 0;
    for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
            const indices = primitive.getIndices();
            for (const accessor of [...primitive.listAttributes(), ...(indices ? [indices] : [])]) {
                if (seen.has(accessor)) continue;
                seen.add(accessor);
                const component = draco && accessor !== indices ? 4 : accessor.getComponentSize();
                geometry += accessor.getCount() * accessor.getElementSize() * component;
            }
        }
    }
    return { textures: Math.round(textures), geometry, total: Math.round(textures + geometry) };
}

export function extensionsOf(doc: Document): { required: string[]; decoders: string[] } {
    const root = doc.getRoot();
    const required = root.listExtensionsRequired().map((extension) => extension.extensionName);
    const decoders = root.listExtensionsUsed().flatMap((extension) => {
        const decoder = DECODERS[extension.extensionName as keyof typeof DECODERS];
        return decoder ? [decoder.name] : [];
    });
    return { required, decoders };
}

export function decoderBytes(names: readonly string[]): number {
    return [...new Set(names)].reduce((total, name) => total + (Object.values(DECODERS).find((decoder) => decoder.name === name)?.bytes ?? 0), 0);
}

export function decoderWarnings(names: readonly string[]): string[] {
    return [...new Set(names)].map(
        (name) =>
            `output needs the ${name} decoder (${Math.round(decoderBytes([name]) / 1000)} KB gzip): Babylon.js loads it automatically; other viewers must be set up to load it`
    );
}

export function formatNotes(doc: Document): string[] {
    return doc
        .getRoot()
        .listExtensionsUsed()
        .some((extension) => extension.extensionName === "EXT_texture_avif")
        ? ["uses AVIF textures (EXT_texture_avif): the browser must support AVIF"]
        : [];
}

export function docSummary(doc: Document) {
    const root = doc.getRoot();
    let triangles = 0;
    let vertices = 0;
    for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
            const position = primitive.getAttribute("POSITION");
            vertices += position?.getCount() ?? 0;
            const count = primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0;
            if (primitive.getMode() === 4) triangles += count / 3;
            if (primitive.getMode() === 5 || primitive.getMode() === 6) triangles += Math.max(0, count - 2);
        }
    }
    let textureBytes = 0;
    let maxTexture = 0;
    const groups = new Map<string, number>();
    for (const texture of root.listTextures()) {
        const size = texture.getSize() ?? [0, 0];
        textureBytes += texture.getImage()?.byteLength ?? 0;
        maxTexture = Math.max(maxTexture, size[0]!, size[1]!);
        const group = `${texture.getMimeType().replace("image/", "")} ${size[0]}x${size[1]}`;
        groups.set(group, (groups.get(group) ?? 0) + 1);
    }
    return {
        triangles: Math.round(triangles),
        vertices,
        textureBytes,
        textures: [...groups].map(([group, count]) => `${count}x ${group}`).join(", ") || "none",
        maxTexture,
        meshes: root.listMeshes().length,
        materials: root.listMaterials().length,
        animations: root.listAnimations().length,
        nodes: root.listNodes().length,
    };
}

export function loadSeconds(doc: Document, bytes: number, network: Network = "4g", amortize = 1): number {
    return ((bytes + decoderBytes(extensionsOf(doc).decoders) / amortize) * 8) / (NETWORKS[network] * 1e6) + decodeMs(features(doc, bytes)) / 1000;
}

export async function validate(bytes: Uint8Array): Promise<{ errors: number; codes: string[] }> {
    try {
        const result = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 200, ignoredIssues: ["UNSUPPORTED_EXTENSION"] });
        return { errors: result.issues.numErrors, codes: [...new Set(result.issues.messages.filter((message) => message.severity === 0).map((message) => message.code))] };
    } catch {
        return { errors: 1, codes: ["UNREADABLE"] };
    }
}
