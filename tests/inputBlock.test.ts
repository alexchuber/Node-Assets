import { describe, expect, it, vi } from "vitest";

import { InputBlock, NodeAsset, NodeAssetBlock, OutputBlock, type ConnectionPoint } from "../src/index";
import { expectRejectedAsync } from "./testUtils";

class TwoInputBlock extends NodeAssetBlock {
    public readonly firstInput: ConnectionPoint<"File", "input"> = this.registerInput("first input", "File");
    public readonly secondInput: ConnectionPoint<"File", "input"> = this.registerInput("second input", "File");
    public readonly output: ConnectionPoint<"File", "output"> = this.registerOutput("output", "File");

    protected override async _buildAsync(): Promise<void> {
        const firstInput = await this.readInputAsync(this.firstInput);
        const secondInput = await this.readInputAsync(this.secondInput);
        const output = new Uint8Array(firstInput.length + secondInput.length);
        output.set(firstInput);
        output.set(secondInput, firstInput.length);
        this.writeOutput(this.output, output);
    }
}

describe("InputBlock", () => {
    it("flows ArrayBuffer sources to an output block", async () => {
        const expected = new Uint8Array([11, 22, 33, 44]);
        const result = await buildSourceAsync(expected.buffer.slice(0));

        expect(result).toEqual(expected);
    });

    it("normalizes an offset typed-array source without including surrounding bytes", async () => {
        const expected = new Uint8Array([11, 22, 33, 44]);
        const backing = new Uint8Array([90, ...expected, 91]);
        const source = new Uint8ClampedArray(backing.buffer, 1, expected.byteLength);
        const result = await buildSourceAsync(source);

        expect(result).toEqual(expected);
        expect(result).not.toBe(source);
    });

    it("normalizes an offset DataView source without including surrounding bytes", async () => {
        const expected = new Uint8Array([51, 62, 73, 84]);
        const backing = new Uint8Array([70, 71, ...expected, 72]);
        const source = new DataView(backing.buffer, 2, expected.byteLength);
        const result = await buildSourceAsync(source);

        expect(result).toEqual(expected);
        expect(result).not.toBe(source);
    });

    it("defers URL fetching until graph build", async () => {
        const expected = new Uint8Array([101, 102, 103]);
        const input = new InputBlock("remote source");
        input.source = "https://example.test/asset.glb";
        const output = new OutputBlock("destination");
        input.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(expected));

        try {
            expect(fetchSpy).not.toHaveBeenCalled();
            await asset.buildAsync();
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(output.data).toEqual(expected);
        } finally {
            fetchSpy.mockRestore();
            asset.dispose();
        }
    });

    it("aborts a pending URL fetch and rejects with the graph disposal error", async () => {
        const url = "https://example.test/pending.glb";
        const graph = createInputGraph(url);
        let signal: AbortSignal | null | undefined;
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
            signal = init?.signal;
            return new Promise<Response>((_, reject) => {
                if (signal?.aborted) {
                    reject(new DOMException("The operation was aborted.", "AbortError"));
                    return;
                }

                signal?.addEventListener(
                    "abort",
                    () => {
                        reject(new DOMException("The operation was aborted.", "AbortError"));
                    },
                    { once: true }
                );
            });
        });

        try {
            const build = graph.asset.buildAsync();
            const fetchCall = fetchSpy.mock.calls[0];
            expect(fetchCall?.[0]).toBe(url);
            expect(fetchCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
            graph.asset.dispose();

            expect(signal?.aborted).toBe(true);
            await expectRejectedAsync(build);
            expect(() => graph.output.data).toThrow();
        } finally {
            fetchSpy.mockRestore();
            graph.asset.dispose();
        }
    });

    it("keeps output unavailable when URL loading fails", async () => {
        const url = "not a URL";
        const graph = createInputGraph(url);
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to parse URL"));

        try {
            await expectRejectedAsync(graph.asset.buildAsync());
            expect(() => graph.output.data).toThrow();
        } finally {
            fetchSpy.mockRestore();
            graph.asset.dispose();
        }
    });

    it("rejects unsuccessful URL responses without publishing output", async () => {
        const url = "https://example.test/missing.glb";
        const graph = createInputGraph(url);
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));

        try {
            await expectRejectedAsync(graph.asset.buildAsync());
            expect(() => graph.output.data).toThrow();
        } finally {
            fetchSpy.mockRestore();
            graph.asset.dispose();
        }
    });

    it("fetches fresh URL data for every rebuild", async () => {
        const url = "https://example.test/asset.glb";
        const first = new Uint8Array([1, 2]);
        const second = new Uint8Array([3, 4, 5]);
        const graph = createInputGraph(url);
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(first)).mockResolvedValueOnce(new Response(second));

        try {
            await graph.asset.buildAsync();
            expect(graph.output.data).toEqual(first);

            await graph.asset.buildAsync();
            expect(graph.output.data).toEqual(second);
            expect(fetchSpy).toHaveBeenCalledTimes(2);
            const firstCall = fetchSpy.mock.calls[0];
            const secondCall = fetchSpy.mock.calls[1];
            expect(firstCall?.[0]).toBe(url);
            expect(firstCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
            expect(secondCall?.[0]).toBe(url);
            expect(secondCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
            expect(firstCall?.[1]?.signal).not.toBe(secondCall?.[1]?.signal);
        } finally {
            fetchSpy.mockRestore();
            graph.asset.dispose();
        }
    });

    it("does not fetch a URL when structural validation fails", async () => {
        const input = new InputBlock("remote source");
        input.source = "https://example.test/asset.glb";
        const requiredInputs = new TwoInputBlock("required inputs");
        const output = new OutputBlock("destination");
        input.output.connectTo(requiredInputs.firstInput);
        requiredInputs.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        try {
            await expectRejectedAsync(asset.buildAsync());
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
            asset.dispose();
        }
    });
});

async function buildSourceAsync(source: NonNullable<InputBlock["source"]>): Promise<Uint8Array> {
    const graph = createInputGraph(source);

    try {
        await graph.asset.buildAsync();
        return graph.output.data;
    } finally {
        graph.asset.dispose();
    }
}

function createInputGraph(source: NonNullable<InputBlock["source"]>): InputGraph {
    const input = new InputBlock("source");
    input.source = source;
    const output = new OutputBlock("destination");
    input.output.connectTo(output.input);

    const asset = new NodeAsset("graph");
    asset.addOutputBlock(output);

    return { asset, output };
}

interface InputGraph {
    readonly asset: NodeAsset;
    readonly output: OutputBlock;
}
