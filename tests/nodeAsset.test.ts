import { describe, expect, it } from "vitest";

import { InputBlock, NodeAsset, NodeAssetBlock, OutputBlock, type ConnectionPoint } from "../src/index";

class SceneInputBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"SceneAsset", "input"> = this.registerInput("input", "SceneAsset");

    protected override _buildAsync(): Promise<void> {
        return Promise.resolve();
    }
}

class PrefixBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input"> = this.registerInput("input", "File");
    public readonly output: ConnectionPoint<"File", "output"> = this.registerOutput("output", "File");

    protected override async _buildAsync(): Promise<void> {
        const input = await this.readInputAsync(this.input);
        const output = new Uint8Array(input.length + 1);
        output[0] = 9;
        output.set(input, 1);
        this.writeOutput(this.output, output);
    }
}

class SingleUseBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input"> = this.registerInput("input", "File");
    public readonly output: ConnectionPoint<"File", "output"> = this.registerOutput("output", "File");

    private _buildCount = 0;

    protected override async _buildAsync(): Promise<void> {
        this._buildCount += 1;
        if (this._buildCount === 1) {
            this.writeOutput(this.output, await this.readInputAsync(this.input));
        }
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

    it("supports custom blocks through the exported authoring seam", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([1, 2]);
        const prefix = new PrefixBlock("prefix");
        const output = new OutputBlock("destination");

        input.output.connectTo(prefix.input);
        prefix.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        await asset.buildAsync();

        expect(output.data).toEqual(new Uint8Array([9, 1, 2]));
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

    it("does not reuse transient values after a failed rebuild", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([4, 5]);
        const singleUse = new SingleUseBlock("single use");
        const output = new OutputBlock("destination");

        input.output.connectTo(singleUse.input);
        singleUse.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        await asset.buildAsync();
        expect(output.data).toEqual(new Uint8Array([4, 5]));

        await expect(asset.buildAsync()).rejects.toThrow("did not produce a value during this build.");
        expect(() => output.data).toThrow('Output block "destination"');
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
