export interface ReferenceOptions {
    readonly size?: number;
    readonly views?: number;
}

export interface Frame {
    readonly c: readonly [number, number, number];
    readonly r: number;
}

export interface ReferenceResult {
    readonly frame: Frame;
    readonly loadMs: number;
}

export interface EvaluationResult {
    readonly worst: number;
    readonly worstView: number;
    readonly loadMs: number;
}

export interface RenderPage {
    setReference(url: string, options: Required<ReferenceOptions>): Promise<ReferenceResult>;
    evaluate(url: string): Promise<EvaluationResult>;
    preview(view: number): string;
}

declare global {
    interface Window {
        fidelityRenderer?: RenderPage;
    }
}
