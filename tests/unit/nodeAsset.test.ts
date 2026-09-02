import { describe, expect, it } from "vitest";

import { Block } from "../../src/blocks/block";
import { NodeAsset, NodeAssetContext } from "../../src/index";
import { ScaleDefinition, NumberDefinition } from "../fixtures/numberBlocks";

describe("NodeAsset", () => {
    it("treats an unconnected input as a graph input", async () => {
        const block = new Block(ScaleDefinition);
        const nodeAsset = new NodeAsset({ name: "external-input", outputBlock: block });
        const context = new NodeAssetContext(nodeAsset);
        context.setInput(block, 3);

        await expect(nodeAsset.executeAsync(context)).resolves.toMatchObject({ output: 6 });
    });

    it("rejects execution without a required input value", async () => {
        const block = new Block(NumberDefinition);
        const nodeAsset = new NodeAsset({ name: "missing-input", outputBlock: block });

        await expect(nodeAsset.executeAsync()).rejects.toThrow();
    });

    it("rejects context inputs outside the node asset", () => {
        const firstBlock = new Block(NumberDefinition, { input: 1 });
        const firstNodeAsset = new NodeAsset({ name: "first", outputBlock: firstBlock });
        const secondBlock = new Block(NumberDefinition, { input: 2 });

        const context = new NodeAssetContext(firstNodeAsset);

        expect(() => context.setInput(secondBlock, 3)).toThrow();
    });

    it("rejects context values for connected inputs", () => {
        const source = new Block(NumberDefinition, { input: 1 });
        const destination = new Block(NumberDefinition);
        source.output.connectTo(destination.input);
        const nodeAsset = new NodeAsset({ name: "connected-input", outputBlock: destination });
        const context = new NodeAssetContext(nodeAsset);

        expect(() => context.setInput(destination, 3)).toThrow();
    });

    it("executes node assets with independent context inputs", async () => {
        const inputBlock = new Block(NumberDefinition, { input: 2 });
        const scaleBlock = new Block(ScaleDefinition, { scale: "triple" });
        const outputBlock = new Block(NumberDefinition);

        inputBlock.output.connectTo(scaleBlock.input);
        scaleBlock.output.connectTo(outputBlock.input);

        const nodeAsset = new NodeAsset({ name: "number-pipeline", outputBlock });

        const context = new NodeAssetContext(nodeAsset);
        context.setInput(inputBlock, 4);

        const [defaultResult, contextResult] = await Promise.all([nodeAsset.executeAsync(), nodeAsset.executeAsync(context)]);

        expect(defaultResult.output).toBe(6);
        expect(contextResult.output).toBe(12);
        expect(contextResult.outputBlock).toBe(nodeAsset.outputBlock);
    });
});
