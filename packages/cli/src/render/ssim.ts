import { emptyModelError } from "./errors";

interface PreparedPixels {
    readonly luminance: Float32Array;
    readonly mask: Uint8Array;
}

export interface PreparedReference extends PreparedPixels {
    readonly mean: Float32Array;
    readonly squareMean: Float32Array;
}

export function createScorer() {
    const weights: number[] = [];
    let sum = 0;
    for (let i = -5; i <= 5; i++) {
        const value = Math.exp(-(i * i) / 4.5);
        weights.push(value);
        sum += value;
    }
    const kernel = Float32Array.from(weights.map((value) => value / sum));

    function blur(source: Float32Array, size: number, temporary: Float32Array, output: Float32Array): Float32Array {
        for (let y = 0; y < size; y++) {
            const offset = y * size;
            for (let x = 0; x < size; x++) {
                let value = 0;
                for (let k = 0; k < 11; k++) value += source[offset + Math.max(0, Math.min(size - 1, x + k - 5))]! * kernel[k]!;
                temporary[offset + x] = value;
            }
        }
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let value = 0;
                for (let k = 0; k < 11; k++) value += temporary[Math.max(0, Math.min(size - 1, y + k - 5)) * size + x]! * kernel[k]!;
                output[y * size + x] = value;
            }
        }
        return output;
    }

    return {
        prepare(pixels: Uint8Array, size: number): PreparedReference {
            const n = size * size;
            const { luminance, mask } = preparePixels(pixels, n);
            if (!mask.includes(1)) throw emptyModelError();
            const temporary = new Float32Array(n);
            const squares = new Float32Array(n);
            for (let i = 0; i < n; i++) squares[i] = luminance[i]! * luminance[i]!;
            return {
                luminance,
                mask,
                mean: blur(luminance, size, temporary, new Float32Array(n)),
                squareMean: blur(squares, size, temporary, new Float32Array(n)),
            };
        },
        worstTile(reference: PreparedReference, pixels: Uint8Array, size: number): number {
            if (!reference.mask.includes(1)) throw emptyModelError();
            const n = size * size;
            const candidate = preparePixels(pixels, n);
            const temporary = new Float32Array(n);
            const mean = blur(candidate.luminance, size, temporary, new Float32Array(n));
            const products = new Float32Array(n);
            for (let i = 0; i < n; i++) products[i] = candidate.luminance[i]! * candidate.luminance[i]!;
            const squareMean = blur(products, size, temporary, new Float32Array(n));
            for (let i = 0; i < n; i++) products[i] = reference.luminance[i]! * candidate.luminance[i]!;
            const crossMean = blur(products, size, temporary, new Float32Array(n));
            const ssim = new Float32Array(n);
            const c1 = 1e-4;
            const c2 = 9e-4;
            for (let i = 0; i < n; i++) {
                const mx = reference.mean[i]!;
                const my = mean[i]!;
                ssim[i] =
                    ((2 * mx * my + c1) * (2 * (crossMean[i]! - mx * my) + c2)) /
                    ((mx * mx + my * my + c1) * (reference.squareMean[i]! - mx * mx + (squareMean[i]! - my * my) + c2));
            }
            const mask = new Uint8Array(n);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    if (!(reference.mask[y * size + x]! | candidate.mask[y * size + x]!)) continue;
                    for (let dy = -3; dy <= 3; dy++) {
                        const yy = y + dy;
                        if (yy < 0 || yy >= size) continue;
                        for (let dx = -3; dx <= 3; dx++) {
                            const xx = x + dx;
                            if (xx >= 0 && xx < size) mask[yy * size + xx] = 1;
                        }
                    }
                }
            }
            let worst = 1;
            let qualified = false;
            let objectSum = 0;
            let objectCount = 0;
            for (let ty = 0; ty < size; ty += 64) {
                for (let tx = 0; tx < size; tx += 64) {
                    let tileSum = 0;
                    let count = 0;
                    let total = 0;
                    for (let y = ty; y < Math.min(size, ty + 64); y++) {
                        for (let x = tx; x < Math.min(size, tx + 64); x++) {
                            total++;
                            if (mask[y * size + x]) {
                                tileSum += ssim[y * size + x]!;
                                count++;
                            }
                        }
                    }
                    objectSum += tileSum;
                    objectCount += count;
                    if (count / total > 0.25) {
                        qualified = true;
                        worst = Math.min(worst, tileSum / count);
                    }
                }
            }
            if (!objectCount) throw emptyModelError();
            return qualified ? worst : objectSum / objectCount;
        },
    };
}

function preparePixels(pixels: Uint8Array, n: number): PreparedPixels {
    const luminance = new Float32Array(n);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const alpha = pixels[i * 4 + 3]! / 255;
        const gray = 0.5 * (1 - alpha);
        luminance[i] =
            0.2126 * ((pixels[i * 4]! / 255) * alpha + gray) + 0.7152 * ((pixels[i * 4 + 1]! / 255) * alpha + gray) + 0.0722 * ((pixels[i * 4 + 2]! / 255) * alpha + gray);
        mask[i] = alpha > 0 ? 1 : 0;
    }
    return { luminance, mask };
}
