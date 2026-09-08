export function generateGltfDataUri(): string {
    return `data:${generateGltfJson()}`;
}

export function generateTexturedGltfDataUri(): string {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8DwH4QZYAwAR8oH+Xm0fdIAAAAASUVORK5CYII=";
    const binary = "AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAABAAIA";
    return `data:${JSON.stringify({
        asset: { version: "2.0" },
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, max: [1, 1, 0], min: [0, 0, 0], type: "VEC3" },
            { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
            { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        buffers: [{ byteLength: 102, uri: `data:application/octet-stream;base64,${binary}` }],
        bufferViews: [
            { buffer: 0, byteLength: 36, byteOffset: 0 },
            { buffer: 0, byteLength: 36, byteOffset: 36 },
            { buffer: 0, byteLength: 24, byteOffset: 72 },
            { buffer: 0, byteLength: 6, byteOffset: 96 },
        ],
        images: [{ uri: `data:image/png;base64,${png}` }],
        materials: [
            {
                emissiveTexture: { index: 0 },
                pbrMetallicRoughness: {
                    baseColorTexture: { index: 0 },
                },
            },
        ],
        meshes: [{ primitives: [{ attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
        nodes: [{ mesh: 0 }],
        samplers: [{ magFilter: 9729 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
        textures: [{ sampler: 0, source: 0 }],
    })}`;
}

export function generateGlbDataUri(): string {
    const gltf = JSON.parse(generateGltfJson()) as {
        buffers: Array<{ byteLength: number; uri?: string }>;
    };

    const dataUri = gltf.buffers[0]?.uri;
    if (!dataUri) {
        throw new Error("Expected an embedded buffer");
    }

    const binary = Uint8Array.from(atob(dataUri.slice(dataUri.indexOf(",") + 1)), (character) => character.charCodeAt(0));
    delete gltf.buffers[0]?.uri;

    const json = new TextEncoder().encode(JSON.stringify(gltf));
    const jsonLength = (json.byteLength + 3) & ~3;
    const binaryLength = (binary.byteLength + 3) & ~3;
    const binaryChunkOffset = 20 + jsonLength;
    const totalLength = binaryChunkOffset + 8 + binaryLength;

    const glb = new Uint8Array(totalLength);
    const header = new DataView(glb.buffer);

    header.setUint32(0, 0x46546c67, true);
    header.setUint32(4, 2, true);
    header.setUint32(8, totalLength, true);
    header.setUint32(12, jsonLength, true);
    header.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    glb.fill(0x20, 20 + json.byteLength, binaryChunkOffset);
    header.setUint32(binaryChunkOffset, binaryLength, true);
    header.setUint32(binaryChunkOffset + 4, 0x004e4942, true);
    glb.set(binary, binaryChunkOffset + 8);

    return `data:model/gltf-binary;base64,${toBase64(glb)}`;
}

function generateGltfJson(): string {
    return JSON.stringify({
        asset: { version: "2.0" },
        buffers: [
            {
                byteLength: 78,
                uri: "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAABAAIA",
            },
        ],
        bufferViews: [
            { buffer: 0, byteLength: 36, byteOffset: 0 },
            { buffer: 0, byteLength: 36, byteOffset: 36 },
            { buffer: 0, byteLength: 6, byteOffset: 72 },
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, max: [1, 1, 0], min: [0, 0, 0], type: "VEC3" },
            { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        meshes: [{ primitives: [{ attributes: { NORMAL: 1, POSITION: 0 }, indices: 2 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
    });
}

function toBase64(data: Uint8Array): string {
    let binary = "";
    for (const byte of data) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
