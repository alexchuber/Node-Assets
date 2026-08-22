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

class DelayedBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input"> = this.registerInput("input", "File");
    public readonly output: ConnectionPoint<"File", "output"> = this.registerOutput("output", "File");
    public readonly started: Promise<void>;

    private _releaseBuild!: () => void;
    private readonly _releasePromise: Promise<void>;
    private _buildCount = 0;

    public constructor(name: string) {
        super(name);
        this._releasePromise = new Promise<void>((resolve) => {
            this._releaseBuild = resolve;
        });
        this.started = new Promise<void>((resolve) => {
            this._startBuild = resolve;
        });
    }

    private _startBuild!: () => void;

    public release(): void {
        this._releaseBuild();
    }

    protected override async _buildAsync(): Promise<void> {
        this._buildCount += 1;
        this._startBuild();
        if (this._buildCount === 1) {
            await this._releasePromise;
        }

        this.writeOutput(this.output, await this.readInputAsync(this.input));
    }
}

class PublishingOutputBlock extends OutputBlock {
    public afterPublish: (() => Promise<void>) | undefined;

    protected override async _buildAsync(): Promise<void> {
        await super._buildAsync();
        if (this.afterPublish !== undefined) {
            await this.afterPublish();
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
        }).toThrow('Cannot connect these two connectors. source: "source".output, target: "scene consumer".input');
    });

    it("rejects output-to-output connections at connect time", () => {
        const source = new InputBlock("source");
        const otherSource = new InputBlock("other source");

        let thrown: unknown;
        try {
            // @ts-expect-error Output connection points can only connect to inputs.
            source.output.connectTo(otherSource.output);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).toHaveProperty("message", 'Cannot connect these two connectors. source: "source".output, target: "other source".output');
    });

    it("rejects input-to-input connections at connect time", () => {
        const first = new OutputBlock("first");
        const second = new OutputBlock("second");

        let thrown: unknown;
        try {
            // @ts-expect-error Input connection points cannot be sources.
            first.input.connectTo(second.input);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).toHaveProperty("message", 'Cannot connect these two connectors. source: "first".input, target: "second".input');
    });

    it("rejects a second connection to an occupied input at connect time", () => {
        const firstSource = new InputBlock("first source");
        const secondSource = new InputBlock("second source");
        const destination = new OutputBlock("destination");
        firstSource.output.connectTo(destination.input);

        let thrown: unknown;
        try {
            secondSource.output.connectTo(destination.input);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).toHaveProperty("message", 'Cannot connect these two connectors. source: "second source".output, target: "destination".input');
    });

    it("rejects a connection that would create a cycle at connect time", () => {
        const first = new PrefixBlock("first");
        const middle = new PrefixBlock("middle");
        const last = new PrefixBlock("last");
        first.output.connectTo(middle.input);
        middle.output.connectTo(last.input);

        let thrown: unknown;
        try {
            last.output.connectTo(first.input);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).toHaveProperty("message", 'Cannot connect these two connectors. source: "last".output, target: "first".input');
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

    it("rejects overlapping builds without corrupting the original build", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([6, 7]);
        const delayed = new DelayedBlock("delayed");
        const output = new OutputBlock("destination");
        input.output.connectTo(delayed.input);
        delayed.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        const firstBuild = asset.buildAsync();
        await delayed.started;

        const secondBuild = asset.buildAsync();
        delayed.release();

        await expect(secondBuild).rejects.toThrow('NodeAsset "graph" cannot build because a build is already in progress.');
        await expect(firstBuild).resolves.toBeUndefined();
        expect(output.data).toEqual(new Uint8Array([6, 7]));
    });

    it("rejects concurrent builds that share a block across assets", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([12, 13]);
        const delayed = new DelayedBlock("delayed");
        const output = new OutputBlock("shared destination");
        input.output.connectTo(delayed.input);
        delayed.output.connectTo(output.input);

        const firstAsset = new NodeAsset("first graph");
        const secondAsset = new NodeAsset("second graph");
        firstAsset.addOutputBlock(output);
        secondAsset.addOutputBlock(output);

        const firstBuild = firstAsset.buildAsync();
        await delayed.started;
        const secondBuild = secondAsset.buildAsync();
        delayed.release();

        const results = await Promise.allSettled([firstBuild, secondBuild]);
        expect(results[0]?.status).toBe("fulfilled");
        expect(results[1]?.status).toBe("rejected");
        if (results[1]?.status === "rejected") {
            expect(results[1].reason).toHaveProperty("message", 'Block "shared destination" cannot be built concurrently because it is already executing.');
        }
        expect(output.data).toEqual(new Uint8Array([12, 13]));

        await secondAsset.buildAsync();
        expect(output.data).toEqual(new Uint8Array([12, 13]));
    });

    it("preserves a published output when a competing graph starts afterward", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([14, 15]);
        const output = new PublishingOutputBlock("shared destination");
        input.output.connectTo(output.input);

        const firstAsset = new NodeAsset("first graph");
        const secondAsset = new NodeAsset("second graph");
        firstAsset.addOutputBlock(output);
        secondAsset.addOutputBlock(output);

        let competingError: Error | undefined;
        output.afterPublish = async () => {
            try {
                await secondAsset.buildAsync();
            } catch (error) {
                if (error instanceof Error) {
                    competingError = error;
                } else {
                    throw error;
                }
            }
        };

        await expect(firstAsset.buildAsync()).resolves.toBeUndefined();
        expect(competingError).toHaveProperty("message", 'Block "shared destination" cannot be built concurrently because it is already executing.');
        expect(output.data).toEqual(new Uint8Array([14, 15]));
    });

    it("makes disposal terminal for an active build", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([8, 9]);
        const delayed = new DelayedBlock("delayed");
        const output = new OutputBlock("destination");
        input.output.connectTo(delayed.input);
        delayed.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        const build = asset.buildAsync();
        await delayed.started;

        asset.dispose();
        delayed.release();

        await expect(build).rejects.toThrow('NodeAsset "graph" was disposed while a build was in progress.');
        expect(() => output.data).toThrow('Output block "destination"');
        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" has been disposed');
        expect(() => asset.addOutputBlock(new OutputBlock("later"))).toThrow('NodeAsset "graph" has been disposed');
    });

    it("clears output data when disposing a completed graph", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([10, 11]);
        const output = new OutputBlock("destination");
        input.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        await asset.buildAsync();
        expect(output.data).toEqual(new Uint8Array([10, 11]));

        asset.dispose();

        expect(() => output.data).toThrow('Output block "destination"');
    });

    it("rejects a second distinct output root in the single-output tracer", () => {
        const asset = new NodeAsset("graph");
        asset.addOutputBlock(new OutputBlock("first"));

        expect(() => asset.addOutputBlock(new OutputBlock("second"))).toThrow('NodeAsset "graph" supports only one output block in this version.');
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
