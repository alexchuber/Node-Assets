import type { LoadFeatures } from "../../src/loadModel";
import { COEF } from "../../src/loadModel";

export interface Observation {
    readonly input: string;
    readonly ms: number;
    readonly features: LoadFeatures;
}

function dot(a: readonly number[], b: readonly number[]): number {
    return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}

// Pivoted QR avoids squaring the condition number and tolerates absent/dependent features.
function leastSquares(columns: number[][], target: readonly number[], passive: readonly boolean[]): number[] {
    const indices = passive.flatMap((enabled, index) => (enabled ? [index] : []));
    const work = indices.map((index) => [...columns[index]!]);
    const count = indices.length;
    const r = Array.from({ length: count }, () => new Array<number>(count).fill(0));
    const projected = new Array<number>(count).fill(0);
    let rank = 0;
    for (let k = 0; k < count; k++) {
        let pivot = k;
        for (let j = k + 1; j < count; j++) if (dot(work[j]!, work[j]!) > dot(work[pivot]!, work[pivot]!)) pivot = j;
        [work[k], work[pivot]] = [work[pivot]!, work[k]!];
        [indices[k], indices[pivot]] = [indices[pivot]!, indices[k]!];
        for (let i = 0; i < k; i++) [r[i]![k], r[i]![pivot]] = [r[i]![pivot]!, r[i]![k]!];
        const norm = Math.sqrt(dot(work[k]!, work[k]!));
        if (norm <= 1e-10) break;
        const q = work[k]!.map((value) => value / norm);
        r[k]![k] = norm;
        projected[k] = dot(q, target);
        for (let j = k + 1; j < count; j++) {
            const projection = dot(q, work[j]!);
            work[j] = work[j]!.map((value, row) => value - projection * q[row]!);
            const correction = dot(q, work[j]!);
            work[j] = work[j]!.map((value, row) => value - correction * q[row]!);
            r[k]![j] = projection + correction;
        }
        rank++;
    }
    const result = new Array<number>(columns.length).fill(0);
    for (let i = rank - 1; i >= 0; i--) {
        let value = projected[i]!;
        for (let j = i + 1; j < rank; j++) value -= r[i]![j]! * result[indices[j]!]!;
        result[indices[i]!] = value / r[i]![i]!;
    }
    return result;
}

export function nnls(matrix: readonly (readonly number[])[], target: readonly number[]): number[] {
    const width = matrix[0]?.length ?? 0;
    if (!width || matrix.length !== target.length || matrix.some((row) => row.length !== width || row.some((value) => !Number.isFinite(value)))) {
        throw new Error("Expected a finite, nonempty rectangular system.");
    }
    if (target.some((value) => !Number.isFinite(value))) throw new Error("Expected finite measurements.");
    const scales = Array.from({ length: width }, (_, column) => Math.hypot(...matrix.map((row) => row[column]!)) || 1);
    const columns = scales.map((scale, column) => matrix.map((row) => row[column]! / scale));
    const passive = new Array<boolean>(width).fill(false);
    let x = new Array<number>(width).fill(0);
    const tolerance = 1e-10 * Math.max(1, Math.hypot(...target));
    let iterations = 0;
    const limit = 30 * width * width;
    // Lawson–Hanson: admit the largest positive residual gradient, then restore feasibility.
    for (;;) {
        const residual = target.map((value, row) => value - columns.reduce((sum, column, index) => sum + column[row]! * x[index]!, 0));
        let entering = -1;
        let gradient = tolerance;
        for (let column = 0; column < width; column++) {
            const next = dot(columns[column]!, residual);
            if (!passive[column] && next > gradient) {
                entering = column;
                gradient = next;
            }
        }
        if (entering < 0) return x.map((value, index) => Math.max(0, value / scales[index]!));
        passive[entering] = true;
        for (;;) {
            if (++iterations > limit) throw new Error("NNLS did not converge.");
            const z = leastSquares(columns, target, passive);
            if (z.every((value, index) => !passive[index] || value > 0)) {
                x = z;
                break;
            }
            let alpha = 1;
            for (let index = 0; index < width; index++) {
                if (passive[index] && z[index]! <= 0) alpha = Math.min(alpha, x[index]! / (x[index]! - z[index]!) || 0);
            }
            x = x.map((value, index) => value + alpha * (z[index]! - value));
            for (let index = 0; index < width; index++) {
                if (passive[index] && x[index]! <= tolerance) {
                    passive[index] = false;
                    x[index] = 0;
                }
            }
        }
    }
}

function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ranks(values: readonly number[]): number[] {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const result = new Array<number>(values.length);
    for (let start = 0; start < order.length;) {
        let end = start + 1;
        while (end < order.length && order[end]!.value === order[start]!.value) end++;
        for (let index = start; index < end; index++) result[order[index]!.index] = (start + end - 1) / 2;
        start = end;
    }
    return result;
}

function rankCorrelation(a: readonly number[], b: readonly number[]): number | null {
    const x = ranks(a);
    const y = ranks(b);
    const mx = mean(x);
    const my = mean(y);
    const dx = x.map((value) => value - mx);
    const dy = y.map((value) => value - my);
    const denominator = Math.sqrt(dot(dx, dx) * dot(dy, dy));
    return denominator ? dot(dx, dy) / denominator : null;
}

export function fitLoadModel(rows: readonly Observation[]) {
    const keys = Object.keys(COEF) as (keyof typeof COEF)[];
    const matrix = rows.map((row) => keys.map((key) => (key === "c0" ? 1 : (row.features[key] ?? 0))));
    const measured = rows.map((row) => row.ms);
    const weights = nnls(matrix, measured);
    const coefficients = Object.fromEntries(keys.map((key, index) => [key, weights[index]!])) as typeof COEF;
    const predicted = matrix.map((row) => dot(row, weights));
    const errors = measured.map((value, index) => value - predicted[index]!);
    const center = mean(measured);
    const variance = measured.reduce((sum, value) => sum + (value - center) ** 2, 0);
    const fitted = { n: rows.length, r2: variance ? 1 - dot(errors, errors) / variance : null, maeMs: mean(errors.map(Math.abs)) };
    const leaveOneModelOut = [...new Set(rows.map((row) => row.input))].map((input) => {
        const train = rows.flatMap((row, index) => (row.input !== input ? [index] : []));
        const test = rows.flatMap((row, index) => (row.input === input ? [index] : []));
        if (!train.length) return { input, n: test.length, maeMs: null, rankCorrelation: null };
        const heldWeights = nnls(
            train.map((index) => matrix[index]!),
            train.map((index) => measured[index]!)
        );
        const actual = test.map((index) => measured[index]!);
        const heldPredicted = test.map((index) => dot(matrix[index]!, heldWeights));
        return {
            input,
            n: test.length,
            maeMs: mean(actual.map((value, index) => Math.abs(value - heldPredicted[index]!))),
            rankCorrelation: rankCorrelation(actual, heldPredicted),
        };
    });
    return { coefficients, fitted, leaveOneModelOut, predicted };
}
