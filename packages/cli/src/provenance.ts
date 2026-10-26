import { readFile } from "node:fs/promises";

export interface Provenance {
    readonly graph: string;
    readonly input: string;
}

function jsonChunk(bytes: Uint8Array): { json: Record<string, unknown>; end: number } {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
        throw new Error("Invalid GLB header.");
    }
    const length = buffer.readUInt32LE(12);
    const end = 20 + length;
    if (buffer.readUInt32LE(16) !== 0x4e4f534a || length % 4 !== 0 || end > buffer.length) throw new Error("Invalid GLB JSON chunk.");
    for (let offset = end; offset < buffer.length;) {
        if (offset + 8 > buffer.length) throw new Error("Truncated GLB chunk.");
        const size = buffer.readUInt32LE(offset);
        if (size % 4 !== 0 || offset + 8 + size > buffer.length) throw new Error("Invalid GLB chunk length.");
        offset += 8 + size;
    }
    const json: unknown = JSON.parse(buffer.subarray(20, end).toString("utf8"));
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid GLB JSON.");
    return { json: json as Record<string, unknown>, end };
}

export function withProvenance(bytes: Uint8Array, provenance: Provenance): Uint8Array {
    const { json, end } = jsonChunk(bytes);
    const extras = json.extras && typeof json.extras === "object" && !Array.isArray(json.extras) ? json.extras : {};
    json.extras = { ...extras, nodeAssets: provenance };
    const text = Buffer.from(JSON.stringify(json));
    const length = Math.ceil(text.length / 4) * 4;
    const result = Buffer.alloc(20 + length + bytes.length - end, 0x20);
    result.set(bytes.subarray(0, 20));
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(length, 12);
    result.set(text, 20);
    result.set(bytes.subarray(end), 20 + length);
    return result;
}

export function provenanceOf(bytes: Uint8Array): Provenance | null {
    try {
        const { json } = jsonChunk(bytes);
        const value = (json.extras as { nodeAssets?: Partial<Provenance> } | undefined)?.nodeAssets;
        return typeof value?.graph === "string" && typeof value.input === "string" ? { graph: value.graph, input: value.input } : null;
    } catch {
        return null;
    }
}

export async function readProvenanceAsync(file: string): Promise<Provenance | null> {
    return readFile(file).then(provenanceOf, () => null);
}
