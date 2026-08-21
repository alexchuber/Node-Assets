import { describe, expect, it } from "vitest";

import { InputBlock, NodeAsset, NodeAssetBlock, OutputBlock, type ConnectionPoint } from "../src/index";

class SceneInputBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"SceneAsset", "input"> = this.registerInput("input", "SceneAsset");

    protected override _buildAsync(): Promise<void> {
        return Promise.resolve();
    }
}

describe("NodeAsset", () => {
    it("flows input bytes to an output block", async () => {
        const bytes = new Uint8Array([0, 1, 2, 255]);
        const input = new InputBlock("source");
        input.source = bytes;
        const output = new OutputBlock("destination");

        input.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);

        await asset.buildAsync();

        expect(output.data).toEqual(bytes);
    });

    it("guards output data until a graph builds successfully", () => {
        const output = new OutputBlock("destination");

        expect(() => output.data).toThrow('Output block "destination"');
    });

    it("rejects incompatible connection point types at runtime and compile time", () => {
        const input = new InputBlock("source");
        const sceneInput = new SceneInputBlock("scene consumer");

        expect(() => {
            // @ts-expect-error File and SceneAsset connection points are incompatible.
            input.output.connectTo(sceneInput.input);
        }).toThrow('Cannot connect "source.output" of type "File"');
    });

    it("uses fresh build state when rebuilding the graph", async () => {
        const input = new InputBlock("source");
        const output = new OutputBlock("destination");
        input.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);

        input.source = new Uint8Array([1]);
        await asset.buildAsync();
        input.source = new Uint8Array([2, 3]);
        await asset.buildAsync();

        expect(output.data).toEqual(new Uint8Array([2, 3]));
    });

    it("clears output data after a failed rebuild", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([1]);
        const output = new OutputBlock("destination");
        input.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        await asset.buildAsync();

        input.source = undefined;
        await expect(asset.buildAsync()).rejects.toThrow('Input block "source"');
        expect(() => output.data).toThrow('Output block "destination"');
    });

    it("rejects graph use after disposal", async () => {
        const asset = new NodeAsset("graph");
        asset.dispose();

        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" has been disposed');
        expect(() => asset.addOutputBlock(new OutputBlock("destination"))).toThrow('NodeAsset "graph" has been disposed');
    });
});
