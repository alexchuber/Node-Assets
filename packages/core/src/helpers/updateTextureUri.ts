import type { Texture } from "@gltf-transform/core";

export function updateTextureUri(texture: Texture, extension: string): void {
    const uri = texture.getURI();
    if (!uri || uri.startsWith("data:")) {
        return;
    }
    const pathEnd = uri.search(/[?#]/);
    const path = pathEnd === -1 ? uri : uri.slice(0, pathEnd);
    const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const dotIndex = path.lastIndexOf(".");
    texture.setURI(dotIndex > slashIndex ? `${path.slice(0, dotIndex + 1)}${extension}` : `${path}.${extension}`);
}
