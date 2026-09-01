import { defineConnectionPointType } from "../connectionPointType";

export const GltfSourceType = defineConnectionPointType<Uint8Array>("gltf-source", (value): value is Uint8Array => value instanceof Uint8Array);

// todo rename these
export const GlbType = defineConnectionPointType<Uint8Array>("glb", isGlb);

function isGlb(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array && value.length >= 4 && value[0] === 0x67 && value[1] === 0x6c && value[2] === 0x54 && value[3] === 0x46;
}
