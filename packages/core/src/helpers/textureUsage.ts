import type { Texture } from "@gltf-transform/core";
import { listTextureSlots } from "@gltf-transform/functions";

/** Material texture categories accepted by texture transforms. */
export type TextureSlots = "all" | "color" | "data";

export function classifyTexture(
    texture: Texture,
    colorSlots = /color|emissive|diffuse|specularGlossiness/i
): { readonly category: "color" | "data" | "mixed" | "unused"; readonly normal: boolean; readonly otherData: boolean } {
    let color = false;
    let normal = false;
    let otherData = false;
    for (const slot of listTextureSlots(texture)) {
        if (colorSlots.test(slot)) {
            color = true;
        } else if (/normal/i.test(slot)) {
            normal = true;
        } else {
            otherData = true;
        }
    }
    const data = normal || otherData;
    return { category: color && data ? "mixed" : color ? "color" : data ? "data" : "unused", normal, otherData };
}

export function matchesTextureSlots(category: ReturnType<typeof classifyTexture>["category"], slots: TextureSlots): boolean {
    return category !== "mixed" && (slots === "all" || slots === category);
}
