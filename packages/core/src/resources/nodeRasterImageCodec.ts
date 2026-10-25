import type sharpFactory from "sharp";

import { fitImageSize } from "../helpers/fitImageSize";
import { validateDecodedRasterImage, type DecodedRasterImage, type RasterImageCodec, type RasterImageEncodeOptions, type RasterImageMimeType } from "./rasterImageCodec";

export class NodeRasterImageCodec implements RasterImageCodec {
    #sharpPromise: Promise<typeof sharpFactory> | undefined;
    #isDisposed = false;

    public async decodeAsync(image: Uint8Array, _mimeType: RasterImageMimeType): Promise<DecodedRasterImage> {
        const sharp = await this.#getSharpAsync();
        const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return {
            data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            height: info.height,
            width: info.width,
        };
    }

    public async encodeAsync(image: DecodedRasterImage, mimeType: RasterImageMimeType, options?: RasterImageEncodeOptions): Promise<Uint8Array> {
        validateDecodedRasterImage(image);
        const sharp = await this.#getSharpAsync();
        return sharp(image.data, { raw: { channels: 4, height: image.height, width: image.width } })
            .toFormat(toSharpFormat(mimeType), mimeType === "image/png" ? {} : options)
            .toBuffer();
    }

    public async resizeAsync(image: Uint8Array, mimeType: RasterImageMimeType, maxSize: number): Promise<Uint8Array | null> {
        const sharp = await this.#getSharpAsync();
        const instance = sharp(image);
        const metadata = await instance.metadata();
        const { width, height } = metadata.autoOrient;
        if (width === undefined || height === undefined || width < 1 || height < 1) {
            throw new Error("Unable to read positive texture dimensions.");
        }
        if (width <= maxSize && height <= maxSize) {
            await instance.stats();
            return null;
        }

        const [targetWidth, targetHeight] = fitImageSize(width, height, maxSize);
        return instance
            .autoOrient()
            .resize(targetWidth, targetHeight, { fit: "fill" })
            .toFormat(toSharpFormat(mimeType), mimeType === "image/avif" ? { quality: 90 } : undefined)
            .toBuffer();
    }

    public async disposeAsync(): Promise<void> {
        this.#isDisposed = true;
        await this.#sharpPromise?.catch(() => {});
        this.#sharpPromise = undefined;
    }

    async #getSharpAsync(): Promise<typeof sharpFactory> {
        if (this.#isDisposed) {
            throw new Error("Raster image codec is disposed.");
        }
        return (this.#sharpPromise ??= loadSharpAsync());
    }
}

function toSharpFormat(mimeType: RasterImageMimeType): "jpeg" | "png" | "webp" | "avif" {
    return mimeType === "image/jpeg" ? "jpeg" : mimeType === "image/png" ? "png" : mimeType === "image/avif" ? "avif" : "webp";
}

async function loadSharpAsync(): Promise<typeof sharpFactory> {
    const moduleName = "sharp";
    const { default: sharp } = (await import(/* @vite-ignore */ moduleName)) as { default: typeof sharpFactory };
    return sharp;
}
