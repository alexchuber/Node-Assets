import { expect, it } from "vitest";

import { WebRasterImageCodec } from "../../packages/core/src/resources/webRasterImageCodec";

it("rejects browser AVIF operations without requiring browser globals", async () => {
    const codec = new WebRasterImageCodec();
    await expect(codec.encodeAsync({ width: 1, height: 1, data: new Uint8Array(4) }, "image/avif", { quality: 60 })).rejects.toThrow();
    await expect(codec.decodeAsync(new Uint8Array(), "image/avif")).rejects.toThrow();
    await expect(codec.resizeAsync(new Uint8Array(), "image/avif", 1)).rejects.toThrow();
    await codec.disposeAsync();
});
