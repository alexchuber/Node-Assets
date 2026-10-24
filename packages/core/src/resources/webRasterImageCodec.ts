import { fitImageSize } from "../helpers/fitImageSize";
import { validateDecodedRasterImage, type DecodedRasterImage, type RasterImageCodec, type RasterImageEncodeOptions, type RasterImageMimeType } from "./rasterImageCodec";

type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;
type RasterCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class WebRasterImageCodec implements RasterImageCodec {
    #canvas: RasterCanvas | undefined;
    #context: RasterCanvasContext | undefined;
    #gl: WebGL2RenderingContext | undefined;
    #canvasTail: Promise<void> = Promise.resolve();
    readonly #pending = new Set<Promise<unknown>>();
    #accepting = true;
    #disposePromise: Promise<void> | undefined;

    public decodeAsync(image: Uint8Array, mimeType: RasterImageMimeType): Promise<DecodedRasterImage> {
        return this.#acceptAsync(async () => {
            rejectAvif(mimeType);
            if (isWebP(image) && typeof globalThis.document !== "undefined" && typeof globalThis.Image !== "undefined") {
                const source = await decodeImageElementAsync(image, mimeType);
                return await this.#withCanvasAsync(source.width, source.height, (context) => {
                    context.drawImage(source, 0, 0);
                    const pixels = context.getImageData(0, 0, source.width, source.height);
                    return {
                        data: new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
                        height: source.height,
                        width: source.width,
                    };
                });
            }
            if (typeof createImageBitmap !== "function") {
                throw new Error("Texture decoding requires createImageBitmap in this browser.");
            }
            const bitmap = await createImageBitmap(new Blob([toBlobPart(image)]));
            try {
                return this.#readBitmap(bitmap);
            } finally {
                bitmap.close();
            }
        });
    }

    public encodeAsync(image: DecodedRasterImage, mimeType: RasterImageMimeType, options?: RasterImageEncodeOptions): Promise<Uint8Array> {
        return this.#acceptAsync(async () => {
            rejectAvif(mimeType);
            validateDecodedRasterImage(image);
            return this.#withCanvasAsync(image.width, image.height, async (context, canvas) => {
                context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
                return encodeCanvasAsync(canvas, mimeType, options?.quality);
            });
        });
    }

    public resizeAsync(image: Uint8Array, mimeType: RasterImageMimeType, maxSize: number): Promise<Uint8Array | null> {
        return this.#acceptAsync(async () => {
            rejectAvif(mimeType);
            if (typeof createImageBitmap !== "function") {
                throw new Error("Texture resizing requires createImageBitmap in this browser.");
            }
            const bitmap = await createImageBitmap(new Blob([toBlobPart(image)], { type: mimeType }));
            try {
                if (bitmap.width <= maxSize && bitmap.height <= maxSize) {
                    return null;
                }
                const [width, height] = fitImageSize(bitmap.width, bitmap.height, maxSize);
                return await this.#withCanvasAsync(width, height, async (context, canvas) => {
                    context.imageSmoothingEnabled = true;
                    context.imageSmoothingQuality = "high";
                    context.drawImage(bitmap, 0, 0, width, height);
                    return encodeCanvasAsync(canvas, mimeType);
                });
            } finally {
                bitmap.close();
            }
        });
    }

    public disposeAsync(): Promise<void> {
        if (this.#disposePromise !== undefined) {
            return this.#disposePromise;
        }
        this.#accepting = false;
        return (this.#disposePromise = (async () => {
            await Promise.allSettled(Array.from(this.#pending));
            await this.#canvasTail;
            if (this.#canvas !== undefined) {
                this.#canvas.width = 0;
                this.#canvas.height = 0;
            }
            this.#context = undefined;
            this.#canvas = undefined;
            if (this.#gl !== undefined) {
                this.#gl.getExtension("WEBGL_lose_context")?.loseContext();
                this.#gl.canvas.width = 0;
                this.#gl.canvas.height = 0;
                this.#gl = undefined;
            }
        })());
    }

    #readBitmap(bitmap: ImageBitmap): DecodedRasterImage {
        // Preserve the encoder's existing WebGL readback, including its alpha handling.
        if (this.#gl === undefined) {
            if (typeof OffscreenCanvas === "undefined") {
                throw new Error("Texture decoding requires OffscreenCanvas.");
            }
            const gl = new OffscreenCanvas(128, 128).getContext("webgl2", { premultipliedAlpha: false });
            if (gl === null) {
                throw new Error("Texture decoding requires a WebGL2 context.");
            }
            this.#gl = gl;
        }
        const gl = this.#gl;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        try {
            if (texture === null || framebuffer === null) {
                throw new Error("Unable to allocate texture decoding resources.");
            }
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error("Unable to read decoded texture pixels.");
            }
            const data = new Uint8Array(bitmap.width * bitmap.height * 4);
            gl.readPixels(0, 0, bitmap.width, bitmap.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
            return { data, height: bitmap.height, width: bitmap.width };
        } finally {
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteTexture(texture);
            gl.deleteFramebuffer(framebuffer);
        }
    }

    #acceptAsync<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
        if (!this.#accepting) {
            return Promise.reject(new Error("Raster image codec is disposed."));
        }
        const pending = Promise.resolve().then(operation);
        this.#pending.add(pending);
        pending.then(
            () => this.#pending.delete(pending),
            () => this.#pending.delete(pending)
        );
        return pending;
    }

    #withCanvasAsync<TValue>(width: number, height: number, operation: (context: RasterCanvasContext, canvas: RasterCanvas) => TValue | Promise<TValue>): Promise<TValue> {
        const result = this.#canvasTail.then(async () => {
            const { canvas, context } = this.#getCanvas();
            canvas.width = width;
            canvas.height = height;
            return operation(context, canvas);
        });
        this.#canvasTail = result.then(
            () => {},
            () => {}
        );
        return result;
    }

    #getCanvas(): { readonly canvas: RasterCanvas; readonly context: RasterCanvasContext } {
        if (this.#canvas !== undefined && this.#context !== undefined) {
            return { canvas: this.#canvas, context: this.#context };
        }

        let canvas: RasterCanvas;
        let context: RasterCanvasContext | null;
        if (typeof OffscreenCanvas !== "undefined") {
            canvas = new OffscreenCanvas(1, 1);
            context = canvas.getContext("2d", { willReadFrequently: true });
        } else if (typeof globalThis.document !== "undefined") {
            canvas = globalThis.document.createElement("canvas");
            context = canvas.getContext("2d", { willReadFrequently: true });
        } else {
            throw new Error("Texture processing requires canvas support in this browser.");
        }
        if (context === null) {
            throw new Error("Texture processing requires a 2D canvas context.");
        }
        this.#canvas = canvas;
        this.#context = context;
        return { canvas, context };
    }
}

async function decodeImageElementAsync(image: Uint8Array, mimeType: RasterImageMimeType): Promise<HTMLImageElement> {
    const objectUrl = URL.createObjectURL(new Blob([toBlobPart(image)], { type: mimeType }));
    try {
        const element = new Image();
        element.decoding = "async";
        await new Promise<void>((resolve, reject) => {
            element.onload = () => resolve();
            element.onerror = () => reject(new Error("Failed to decode WebP image."));
            element.src = objectUrl;
        });
        return element;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function toBlobPart(image: Uint8Array): BlobPart {
    return image.buffer instanceof ArrayBuffer ? new Uint8Array(image.buffer, image.byteOffset, image.byteLength) : Uint8Array.from(image);
}

async function encodeCanvasAsync(canvas: RasterCanvas, mimeType: RasterImageMimeType, quality?: number): Promise<Uint8Array> {
    const canvasQuality = mimeType === "image/png" || quality === undefined ? undefined : quality / 100;
    let blob: Blob;
    if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
        blob = await canvas.convertToBlob({ type: mimeType, ...(canvasQuality === undefined ? {} : { quality: canvasQuality }) });
    } else {
        blob = await new Promise<Blob>((resolve, reject) => {
            (canvas as HTMLCanvasElement).toBlob((result) => (result === null ? reject(new Error("Unable to encode raster texture.")) : resolve(result)), mimeType, canvasQuality);
        });
    }
    if (blob.type !== mimeType) {
        throw new Error(`This browser cannot encode ${mimeType} textures.`);
    }
    return new Uint8Array(await blob.arrayBuffer());
}

function rejectAvif(mimeType: RasterImageMimeType): void {
    if (mimeType === "image/avif") {
        throw new Error("AVIF texture processing requires the Node raster image codec (Sharp).");
    }
}

function isWebP(image: Uint8Array): boolean {
    return (
        image.byteLength >= 12 &&
        image[0] === 0x52 &&
        image[1] === 0x49 &&
        image[2] === 0x46 &&
        image[3] === 0x46 &&
        image[8] === 0x57 &&
        image[9] === 0x45 &&
        image[10] === 0x42 &&
        image[11] === 0x50
    );
}
