import { describe, expect, it, vi } from "vitest";

const assetContainerImport = vi.hoisted(() => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { markStarted, release, released, started };
});

vi.mock("@babylonjs/core/assetContainer.js", async (importOriginal) => {
    assetContainerImport.markStarted();
    await assetContainerImport.released;
    return importOriginal();
});

describe("active build disposal", () => {
    it("does not create a scene after lazy imports finish for a disposed graph", async () => {
        const { EngineStore } = await import("@babylonjs/core/Engines/engineStore.js");
        const { InputBlock, NodeAsset, OutputBlock, ParseGLBBlock, SerializeGLBBlock } = await import("../src/index");
        const previousScene = EngineStore.LastCreatedScene;
        const input = new InputBlock("source");
        input.source = new Uint8Array([0]);
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        const asset = new NodeAsset("graph");
        asset.addOutputBlock(output);

        const buildResult = asset.buildAsync().catch((reason: unknown) => reason);
        await assetContainerImport.started;
        asset.dispose();
        assetContainerImport.release();

        await expect(buildResult).resolves.toMatchObject({
            message: 'NodeAsset "graph" was disposed while a build was in progress.',
        });
        expect(EngineStore.LastCreatedScene).toBe(previousScene);
        expect(() => output.data).toThrow('Output block "destination"');
    });
});
