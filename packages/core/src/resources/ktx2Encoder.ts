import type { IEncodeOptions } from "babylonpress-ktx2-encoder";

import type { DecodedKTX2Image, KTX2Encoding } from "./ktx2Image";
import { validateDecodedRasterImage, type DecodedRasterImage } from "./rasterImageCodec";

export interface KTX2EncodeOptions {
    readonly generateMipmaps?: boolean;
    readonly isNormalMap?: boolean;
    readonly isPerceptual: boolean;
    readonly isSetKTX2SRGBTransferFunc: boolean;
    readonly isUASTC?: boolean;
    readonly useZstdSupercompression?: boolean;
    readonly etc1sQuality?: number;
    readonly uastcQuality?: number;
}

export class KTX2Encoder {
    #encoderPromise: ReturnType<typeof loadEncoderAsync> | undefined;

    public encodeAsync(image: DecodedKTX2Image, options?: Partial<KTX2EncodeOptions>): Promise<Uint8Array>;
    public encodeAsync(image: DecodedRasterImage, options: KTX2EncodeOptions): Promise<Uint8Array>;
    public async encodeAsync(image: DecodedRasterImage & { readonly encoding?: KTX2Encoding }, options: Partial<KTX2EncodeOptions> = {}): Promise<Uint8Array> {
        validateDecodedRasterImage(image);
        const encoding = image.encoding;
        const sourceIsSrgb = encoding === undefined ? undefined : encoding.transferFunction === "srgb";
        const isPerceptual = options.isPerceptual ?? sourceIsSrgb;
        const isSetKTX2SRGBTransferFunc = options.isSetKTX2SRGBTransferFunc ?? sourceIsSrgb;
        if (isPerceptual === undefined || isSetKTX2SRGBTransferFunc === undefined) {
            throw new Error("KTX2 encoding requires source encoding metadata or explicit color-space options.");
        }
        const encoderPromise = (this.#encoderPromise ??= loadEncoderAsync());
        let encoder: Awaited<typeof encoderPromise>;
        try {
            encoder = await encoderPromise;
        } catch (error) {
            if (this.#encoderPromise === encoderPromise) {
                this.#encoderPromise = undefined;
            }
            throw error;
        }
        const { encodeToKTX2, wasmUrl } = encoder;
        const encodeOptions: IEncodeOptions = {
            imageDecoder: async () => image,
            isHDR: false,
            isPerceptual,
            isSetKTX2SRGBTransferFunc,
            wasmUrl,
        };
        const generateMipmaps = options.generateMipmaps ?? encoding?.mipmaps;
        const isUASTC = options.isUASTC ?? (encoding === undefined ? undefined : encoding.mode === "uastc");
        const useZstdSupercompression = options.useZstdSupercompression ?? (encoding === undefined ? undefined : isUASTC === true && encoding.supercompression === "zstd");
        if (generateMipmaps !== undefined) {
            encodeOptions.generateMipmap = generateMipmaps;
        }
        if (options.isNormalMap !== undefined) {
            encodeOptions.isNormalMap = options.isNormalMap;
        }
        if (isUASTC !== undefined) {
            encodeOptions.isUASTC = isUASTC;
        }
        if (useZstdSupercompression !== undefined) {
            encodeOptions.needSupercompression = useZstdSupercompression;
        }
        if (options.etc1sQuality !== undefined) {
            encodeOptions.qualityLevel = options.etc1sQuality;
        }
        if (options.uastcQuality !== undefined) {
            encodeOptions.uastcLDRQualityLevel = options.uastcQuality;
        }
        const encoded = await encodeToKTX2(new Uint8Array(), encodeOptions);
        return encoded.byteOffset === 0 && encoded.byteLength === encoded.buffer.byteLength ? encoded : Uint8Array.from(encoded);
    }
}

async function loadEncoderAsync() {
    // The package transform exposes both platform implementations, causing browser bundlers to discover Node built-ins.
    // Use the conditionally exported root encoder until the transform provides platform-conditional exports.
    // The package's relative WASM URL breaks when Vite pre-bundles the dependency.
    const [{ encodeToKTX2 }, { default: wasmUrl }] = await Promise.all([import("babylonpress-ktx2-encoder"), import("virtual:node-assets-basis-encoder-wasm-url")]);
    return { encodeToKTX2, wasmUrl };
}
