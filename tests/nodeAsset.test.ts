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
    public buildCount = 0;

    protected override async _buildAsync(): Promise<void> {
        this.buildCount += 1;
        const input = await this.readInputAsync(this.input);
        const output = new Uint8Array(input.length + 1);
        output[0] = 9;
        output.set(input, 1);
        this.writeOutput(this.output, output);
    }
}

class TrackingOutputBlock extends OutputBlock {
    public buildCount = 0;

    protected override async _buildAsync(): Promise<void> {
        this.buildCount += 1;
        await super._buildAsync();
    }
}

class MergeBlock extends NodeAssetBlock {
    public readonly left = this.registerInput("left", "File");
    public readonly right = this.registerInput("right", "File");
    public readonly output = this.registerOutput("output", "File");
    public buildCount = 0;

    protected override async _buildAsync(): Promise<void> {
        this.buildCount += 1;
        const left = await this.readInputAsync(this.left);
        const right = await this.readInputAsync(this.right);
        const output = new Uint8Array(left.length + right.length);
        output.set(left);
        output.set(right, left.length);
        this.writeOutput(this.output, output);
    }
}

class CountingPassThroughBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input"> = this.registerInput("input", "File");
    public readonly output: ConnectionPoint<"File", "output"> = this.registerOutput("output", "File");
    public buildCount = 0;

    protected override async _buildAsync(): Promise<void> {
        this.buildCount += 1;
        this.writeOutput(this.output, await this.readInputAsync(this.input));
    }
}

class DuplicateInputBlock extends NodeAssetBlock {
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

class DelayedOutputBlock extends OutputBlock {
    public readonly started: Promise<void>;

    private readonly _releasePromise: Promise<void>;
    private _releaseBuild!: () => void;
    private _startBuild!: () => void;

    public constructor(name: string) {
        super(name);
        this._releasePromise = new Promise<void>((resolve) => {
            this._releaseBuild = resolve;
        });
        this.started = new Promise<void>((resolve) => {
            this._startBuild = resolve;
        });
    }

    public release(): void {
        this._releaseBuild();
    }

    protected override async _buildAsync(): Promise<void> {
        await super._buildAsync();
        this._startBuild();
        await this._releasePromise;
    }
}

class GatedOutputBlock extends OutputBlock {
    public started: Promise<void> = Promise.resolve();

    private _releaseBuild!: () => void;
    private _startBuild!: () => void;

    public release(): void {
        this._releaseBuild();
    }

    protected override async _buildAsync(): Promise<void> {
        const releasePromise = new Promise<void>((resolve) => {
            this._releaseBuild = resolve;
        });
        this.started = new Promise<void>((resolve) => {
            this._startBuild = resolve;
        });

        await super._buildAsync();
        this._startBuild();
        await releasePromise;
    }
}

describe("NodeAsset", () => {
    it("rejects a build with no registered output block", async () => {
        const asset = new NodeAsset("graph");

        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" cannot build because no output block has been registered.');
    });

    it("rejects an unconnected required input before executing the graph", async () => {
        const source = new InputBlock("source");
        source.source = new Uint8Array([1, 2]);
        const prefix = new PrefixBlock("prefix");
        const output = new TrackingOutputBlock("destination");
        prefix.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);

        await expect(asset.buildAsync()).rejects.toThrow('Block "prefix" has an unconnected required input "input".');
        expect(prefix.buildCount).toBe(0);
        expect(output.buildCount).toBe(0);
        expect(() => output.data).toThrow('Output block "destination"');

        source.output.connectTo(prefix.input);
        await asset.buildAsync();

        expect(prefix.buildCount).toBe(1);
        expect(output.buildCount).toBe(1);
        expect(output.data).toEqual(new Uint8Array([9, 1, 2]));
    });

    it("aggregates missing required inputs across reachable blocks and ports", async () => {
        const left = new PrefixBlock("left");
        const merge = new MergeBlock("merge");
        const output = new TrackingOutputBlock("destination");
        left.output.connectTo(merge.left);
        merge.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);

        const error = await asset.buildAsync().catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
            return;
        }

        expect(error.message).toBe(
            'NodeAsset "graph" cannot build because the graph has structural errors:\n' +
                'Block "left" has an unconnected required input "input".\n' +
                'Block "merge" has an unconnected required input "right".'
        );
        expect(left.buildCount).toBe(0);
        expect(merge.buildCount).toBe(0);
        expect(output.buildCount).toBe(0);
    });

    it("aggregates missing required inputs across multiple output roots", async () => {
        const first = new PrefixBlock("first");
        const second = new PrefixBlock("second");
        const firstOutput = new TrackingOutputBlock("first.glb");
        const secondOutput = new TrackingOutputBlock("second.glb");
        first.output.connectTo(firstOutput.input);
        second.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);

        await expect(asset.buildAsync()).rejects.toThrow(
            'NodeAsset "graph" cannot build because the graph has structural errors:\n' +
                'Block "first" has an unconnected required input "input".\n' +
                'Block "second" has an unconnected required input "input".'
        );
        expect(first.buildCount).toBe(0);
        expect(second.buildCount).toBe(0);
        expect(firstOutput.buildCount).toBe(0);
        expect(secondOutput.buildCount).toBe(0);
    });

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

    it("evaluates a shared File-producing block once when its output fans out", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([1, 2]);
        const counting = new CountingPassThroughBlock("counting");
        const duplicate = new DuplicateInputBlock("duplicate");
        const output = new OutputBlock("destination");

        input.output.connectTo(counting.input);
        counting.output.connectTo(duplicate.firstInput);
        counting.output.connectTo(duplicate.secondInput);
        duplicate.output.connectTo(output.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);
        await asset.buildAsync();

        expect(output.data).toEqual(new Uint8Array([1, 2, 1, 2]));
        expect(counting.buildCount).toBe(1);
    });

    it("builds multiple output blocks and retains each artifact", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([3, 4]);
        const firstOutput = new OutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");

        input.output.connectTo(firstOutput.input);
        input.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);
        await asset.buildAsync();

        expect(firstOutput.data).toEqual(new Uint8Array([3, 4]));
        expect(secondOutput.data).toEqual(new Uint8Array([3, 4]));
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

    it("refreshes every output on a sequential rebuild", async () => {
        const input = new InputBlock("source");
        const counting = new CountingPassThroughBlock("counting");
        const firstOutput = new OutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");
        input.output.connectTo(counting.input);
        counting.output.connectTo(firstOutput.input);
        counting.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);

        input.source = new Uint8Array([17]);
        await asset.buildAsync();
        input.source = new Uint8Array([18, 19]);
        await asset.buildAsync();

        expect(firstOutput.data).toEqual(new Uint8Array([18, 19]));
        expect(secondOutput.data).toEqual(new Uint8Array([18, 19]));
        expect(counting.buildCount).toBe(2);
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

    it("does not clear another graph's published output after a multi-output overlap", async () => {
        const firstInput = new InputBlock("first source");
        firstInput.source = new Uint8Array([22]);
        const secondInput = new InputBlock("second source");
        secondInput.source = new Uint8Array([23]);
        const firstOutput = new PublishingOutputBlock("first destination");
        const sharedOutput = new DelayedOutputBlock("shared destination");
        firstInput.output.connectTo(firstOutput.input);
        secondInput.output.connectTo(sharedOutput.input);

        const firstAsset = new NodeAsset("first graph");
        const secondAsset = new NodeAsset("second graph");
        firstAsset.addOutputBlock(firstOutput);
        firstAsset.addOutputBlock(sharedOutput);
        secondAsset.addOutputBlock(sharedOutput);

        let competingBuild: Promise<void> | undefined;
        firstOutput.afterPublish = async () => {
            competingBuild = secondAsset.buildAsync();
            await sharedOutput.started;
        };

        await expect(firstAsset.buildAsync()).rejects.toThrow('Block "shared destination" cannot be built concurrently because it is already executing.');
        expect(sharedOutput.data).toEqual(new Uint8Array([23]));
        sharedOutput.release();
        if (competingBuild !== undefined) {
            await expect(competingBuild).resolves.toBeUndefined();
        }
    });

    it("preserves a newer shared output when an older graph is disposed", async () => {
        const input = new InputBlock("source");
        const sharedOutput = new GatedOutputBlock("shared destination");
        const firstOnlyOutput = new OutputBlock("first-only destination");
        input.output.connectTo(sharedOutput.input);
        input.output.connectTo(firstOnlyOutput.input);

        const firstAsset = new NodeAsset("first graph");
        const secondAsset = new NodeAsset("second graph");
        firstAsset.addOutputBlock(sharedOutput);
        firstAsset.addOutputBlock(firstOnlyOutput);
        secondAsset.addOutputBlock(sharedOutput);

        input.source = new Uint8Array([25]);
        const firstBuild = firstAsset.buildAsync();
        await sharedOutput.started;
        sharedOutput.release();
        await expect(firstBuild).resolves.toBeUndefined();

        input.source = new Uint8Array([26]);
        const secondBuild = secondAsset.buildAsync();
        await sharedOutput.started;
        expect(sharedOutput.data).toEqual(new Uint8Array([26]));

        firstAsset.dispose();
        expect(() => firstOnlyOutput.data).toThrow('Output block "first-only destination"');
        await expect(firstAsset.buildAsync()).rejects.toThrow('NodeAsset "first graph" has been disposed');
        expect(sharedOutput.data).toEqual(new Uint8Array([26]));

        sharedOutput.release();
        await expect(secondBuild).resolves.toBeUndefined();
        expect(sharedOutput.data).toEqual(new Uint8Array([26]));
    });

    it("snapshots output roots before a hook can add a duplicate", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([27]);
        const firstOutput = new PublishingOutputBlock("artifact.glb");
        const secondOutput = new OutputBlock("artifact.glb");
        input.output.connectTo(firstOutput.input);
        input.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        let hookCalls = 0;
        firstOutput.afterPublish = () => {
            hookCalls += 1;
            if (hookCalls === 1) {
                asset.addOutputBlock(secondOutput);
            }
            return Promise.resolve();
        };

        await expect(asset.buildAsync()).resolves.toBeUndefined();
        expect(firstOutput.data).toEqual(new Uint8Array([27]));
        expect(() => secondOutput.data).toThrow('Output block "artifact.glb"');
        expect(hookCalls).toBe(1);

        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" has duplicate output block names: "artifact.glb".');
        expect(hookCalls).toBe(1);
        expect(() => firstOutput.data).toThrow('Output block "artifact.glb"');
        expect(() => secondOutput.data).toThrow('Output block "artifact.glb"');
    });

    it("defers a hook-added unique output until the next build", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([28]);
        const firstOutput = new PublishingOutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");
        input.output.connectTo(firstOutput.input);
        input.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        let outputAdded = false;
        firstOutput.afterPublish = () => {
            if (!outputAdded) {
                outputAdded = true;
                asset.addOutputBlock(secondOutput);
            }
            return Promise.resolve();
        };

        await asset.buildAsync();
        expect(firstOutput.data).toEqual(new Uint8Array([28]));
        expect(() => secondOutput.data).toThrow('Output block "second.glb"');

        input.source = new Uint8Array([29]);
        await asset.buildAsync();
        expect(firstOutput.data).toEqual(new Uint8Array([29]));
        expect(secondOutput.data).toEqual(new Uint8Array([29]));
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

    it("reports duplicate output names before executing the graph", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([16]);
        const counting = new CountingPassThroughBlock("counting");
        const firstOutput = new OutputBlock("z.glb");
        const secondOutput = new OutputBlock("a.glb");
        const thirdOutput = new OutputBlock("z.glb");
        const fourthOutput = new OutputBlock("a.glb");
        input.output.connectTo(counting.input);
        counting.output.connectTo(firstOutput.input);
        counting.output.connectTo(secondOutput.input);
        counting.output.connectTo(thirdOutput.input);
        counting.output.connectTo(fourthOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);
        asset.addOutputBlock(thirdOutput);
        asset.addOutputBlock(fourthOutput);

        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" has duplicate output block names: "a.glb", "z.glb".');
        expect(counting.buildCount).toBe(0);
        expect(() => firstOutput.data).toThrow('Output block "z.glb"');
        expect(() => secondOutput.data).toThrow('Output block "a.glb"');
    });

    it("invalidates prior artifacts before duplicate-name validation", async () => {
        const input = new InputBlock("source");
        input.source = new Uint8Array([24]);
        const counting = new CountingPassThroughBlock("counting");
        const firstOutput = new OutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");
        input.output.connectTo(counting.input);
        counting.output.connectTo(firstOutput.input);
        counting.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);
        await asset.buildAsync();
        expect(firstOutput.data).toEqual(new Uint8Array([24]));
        expect(secondOutput.data).toEqual(new Uint8Array([24]));

        asset.addOutputBlock(new OutputBlock("first.glb"));
        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" has duplicate output block names: "first.glb".');

        expect(counting.buildCount).toBe(1);
        expect(() => firstOutput.data).toThrow('Output block "first.glb"');
        expect(() => secondOutput.data).toThrow('Output block "second.glb"');
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

    it("guards every output when a multi-output rebuild fails", async () => {
        const firstInput = new InputBlock("first source");
        firstInput.source = new Uint8Array([20]);
        const secondInput = new InputBlock("second source");
        secondInput.source = new Uint8Array([21]);
        const firstOutput = new OutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");
        firstInput.output.connectTo(firstOutput.input);
        secondInput.output.connectTo(secondOutput.input);

        const asset = new NodeAsset("graph");
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);
        await asset.buildAsync();
        expect(firstOutput.data).toEqual(new Uint8Array([20]));
        expect(secondOutput.data).toEqual(new Uint8Array([21]));

        secondInput.source = undefined;
        await expect(asset.buildAsync()).rejects.toThrow('Input block "second source"');
        expect(() => firstOutput.data).toThrow('Output block "first.glb"');
        expect(() => secondOutput.data).toThrow('Output block "second.glb"');
    });

    it("rejects graph use after disposal", async () => {
        const asset = new NodeAsset("graph");
        asset.dispose();

        await expect(asset.buildAsync()).rejects.toThrow('NodeAsset "graph" has been disposed');
        expect(() => asset.addOutputBlock(new OutputBlock("destination"))).toThrow('NodeAsset "graph" has been disposed');
    });
});
