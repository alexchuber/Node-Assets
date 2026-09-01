import { describe, expect, it } from "vitest";

import { Block } from "../src/blocks/block";
import { defineBlock, enumValue, value } from "../src/blocks/blockDefinition";
import { defineConnectionPointType } from "../src/connectionPointType";
import { NodeAsset, NodeAssetContext } from "../src/index";

const NumberType = defineConnectionPointType<number>("number", (value): value is number => typeof value === "number");
const OtherNumberType = defineConnectionPointType<number>("number", (value): value is number => typeof value === "number");

const NumberDefinition = defineBlock({
    type: "number",
    input: NumberType,
    output: NumberType,
    run: (input) => input,
});

const ScaleDefinition = defineBlock({
    type: "number-scale",
    input: NumberType,
    output: NumberType,
    config: {
        scale: enumValue(["double", "triple"], "double"),
    },
    runAsync: async (input, config) => input * (config.scale === "double" ? 2 : 3),
});

const OtherNumberDefinition = defineBlock({
    type: "other-number",
    input: OtherNumberType,
    output: OtherNumberType,
    run: (input) => input,
});

describe("Block definitions", () => {
    it("sets the block version", () => {
        expect(NumberDefinition).toMatchObject({ version: 1 });
    });

    it("freezes definitions and configuration descriptors", () => {
        expect(Object.isFrozen(ScaleDefinition)).toBe(true);
        expect(Object.isFrozen(ScaleDefinition.config)).toBe(true);
        expect(Object.isFrozen(ScaleDefinition.config.scale)).toBe(true);
    });
});

describe("Block", () => {
    it("has input and output ports", () => {
        const block = new Block(NumberDefinition, { name: "Source", input: 5 });
        expect(block.definition).toBe(NumberDefinition);
        expect(block.name).toBe("Source");
        expect(block.defaultInput).toBe(5);
        expect(block.input.type).toBe(NumberType);
        expect(block.output.type).toBe(NumberType);
    });

    it("can have a config value named the same as a property", () => {
        const WeirdNumberDefinition = defineBlock({
            type: "weird-number",
            input: NumberType,
            output: NumberType,
            config: {
                defaultInput: value(NumberType, 3),
            },
            run: (input) => input,
        });

        const block = new Block(WeirdNumberDefinition, { input: 5 });
        expect(block.config.defaultInput).toBe(3);
    });

    it("uses supplied configuration", () => {
        const block = new Block(ScaleDefinition, { scale: "triple" });
        expect(block.definition).toBe(ScaleDefinition);
        expect(block.config.scale).toBe("triple");
    });

    it("uses configuration defaults", () => {
        const block = new Block(ScaleDefinition);

        expect(block.config.scale).toBe("double");
        expect(Object.isFrozen(block.config)).toBe(true);
    });

    it("rejects invalid configuration", () => {
        expect(() => new Block(ScaleDefinition, { scale: "invalid" as "double" })).toThrow();
    });
});

describe("Connections", () => {
    it("connects ports with the same connection point type", () => {
        const inputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(NumberDefinition);

        inputBlock.output.connectTo(outputBlock.input);

        expect(outputBlock.input._source).toBe(inputBlock.output);
    });

    it("rejects distinct connection point type descriptors", () => {
        const inputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(OtherNumberDefinition);

        expect(() => inputBlock.output.connectTo(outputBlock.input)).toThrow('Cannot connect connection point type "number" to "number".');
    });

    it("rejects a second source for an input", () => {
        const firstInputBlock = new Block(NumberDefinition);
        const secondInputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(NumberDefinition);

        firstInputBlock.output.connectTo(outputBlock.input);

        expect(() => secondInputBlock.output.connectTo(outputBlock.input)).toThrow();
    });

    it("rejects a cyclic connection", () => {
        const firstBlock = new Block(ScaleDefinition);
        const secondBlock = new Block(ScaleDefinition);
        const thirdBlock = new Block(ScaleDefinition);

        firstBlock.output.connectTo(secondBlock.input);
        secondBlock.output.connectTo(thirdBlock.input);

        expect(() => thirdBlock.output.connectTo(firstBlock.input)).toThrow();
    });
});

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
