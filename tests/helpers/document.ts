import { Document } from "@gltf-transform/core";
import sharp from "sharp";

export function createGridDocument(size = 8): Document {
    const document = new Document();
    const buffer = document.createBuffer();
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let y = 0; y <= size; y++) {
        for (let x = 0; x <= size; x++) {
            positions.push(x / size, y / size, Math.sin(x * 0.7) * Math.cos(y * 0.4) * 0.01);
            normals.push(0, 0, 1);
            if (x < size && y < size) {
                const a = y * (size + 1) + x;
                indices.push(a, a + 1, a + size + 1, a + 1, a + size + 2, a + size + 1);
            }
        }
    }
    const position = document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer);
    const normal = document.createAccessor().setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buffer);
    const index = document.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setIndices(index);
    const mesh = document.createMesh().addPrimitive(primitive);
    document.createScene().addChild(document.createNode().setMesh(mesh));
    return document;
}

export async function createRasterImageAsync(format: "png" | "jpeg" | "webp" | "avif" = "png", width = 32, height = 16, alpha = 255): Promise<Uint8Array> {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = (i * 13 + (i >>> 3)) % 256;
        data[i + 1] = (i * 7 + (i >>> 4)) % 256;
        data[i + 2] = (i * 3 + (i >>> 5)) % 256;
        data[i + 3] = alpha;
    }
    const image = sharp(data, { raw: { channels: 4, width, height } });
    return format === "png" ? image.png({ compressionLevel: 0 }).toBuffer() : image.toFormat(format).toBuffer();
}
