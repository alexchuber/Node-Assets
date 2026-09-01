import { describe, expect, it } from "vitest";

import { InputBlock, OutputBlock, TransformBlock } from "../src/blocks/block";
import { defineInputBlock, defineOutputBlock, defineSwitchTransformBlock, defineTransformBlock, defineValueType, enumValue, value } from "../src/blocks/blockDefinition";
import { NodeAsset, NodeAssetContext } from "../src/index";

const NumberType = defineValueType<number>("number", (value): value is number => typeof value === "number");
const OtherNumberType = defineValueType<number>("number", (value): value is number => typeof value === "number");

const NumberInputBlock = defineInputBlock({
    type: "number-input",
    input: NumberType,
    output: NumberType,
    run: (input) => input,
});

const ScaleBlock = defineTransformBlock({
    type: "number-scale",
    input: NumberType,
    output: NumberType,
    config: {
        scale: enumValue(["double", "triple"], "double"),
    },
    runAsync: async (input, config) => input * (config.scale === "double" ? 2 : 3),
});

const NumberOutputBlock = defineOutputBlock({
    type: "number-output",
    input: NumberType,
    output: NumberType,
    run: (input) => input,
});

const OtherNumberOutputBlock = defineOutputBlock({
    type: "other-number-output",
    input: OtherNumberType,
    output: OtherNumberType,
    run: (input) => input,
});

const DoubleBlock = defineTransformBlock({
    type: "double",
    input: NumberType,
    output: NumberType,
    run: (input) => input * 2,
});

const TripleBlock = defineTransformBlock({
    type: "triple",
    input: NumberType,
    output: NumberType,
    run: (input) => input * 3,
});

const ScaleSwitchBlock = defineSwitchTransformBlock({
    type: "scale-switch",
    input: NumberType,
    output: NumberType,
    resolveBlock: (input) => new TransformBlock(input < 0 ? DoubleBlock : TripleBlock),
});

describe("Block definitions", () => {
    it("sets the block kind and version", () => {
        expect(NumberInputBlock).toMatchObject({ kind: "input", version: 1 });
        expect(ScaleBlock).toMatchObject({ kind: "transform", version: 1 });
        expect(NumberOutputBlock).toMatchObject({ kind: "output", version: 1 });
    });

    it("gives switch blocks a resolver instead of a runner", () => {
        expect(ScaleSwitchBlock.resolveBlock).toBeTypeOf("function");
        expect(ScaleSwitchBlock.run).toBeUndefined();
        expect(ScaleSwitchBlock.runAsync).toBeUndefined();
    });

    it("freezes definitions and configuration descriptors", () => {
        expect(Object.isFrozen(ScaleBlock)).toBe(true);
        expect(Object.isFrozen(ScaleBlock.config)).toBe(true);
        expect(Object.isFrozen(ScaleBlock.config.scale)).toBe(true);
    });
});

describe("Block", () => {
    it("can be an input block", () => {
        const block = new InputBlock(NumberInputBlock, { name: "Source", input: 5 });
        expect(block.definition).toBe(NumberInputBlock);
        expect(block.name).toBe("Source");
        expect(block.defaultInput).toBe(5);
    });

    it("can have a config value named the same as a property", () => {
        const WeirdNumberInputBlock = defineInputBlock({
            type: "number-input",
            input: NumberType,
            output: NumberType,
            config: {
                defaultInput: value(NumberType, 3),
            },
            run: (input) => input,
        });

        const block = new InputBlock(WeirdNumberInputBlock, { input: 5 });
        expect(block.config.defaultInput).toBe(3);
    });

    it("can be a transform block", () => {
        const block = new TransformBlock(ScaleBlock, { scale: "triple" });
        expect(block.definition).toBe(ScaleBlock);
        expect(block.config.scale).toBe("triple");
        expect(block.input.type).toBe(NumberType);
    });

    it("uses configuration defaults", () => {
        const block = new TransformBlock(ScaleBlock);

        expect(block.config.scale).toBe("double");
        expect(Object.isFrozen(block.config)).toBe(true);
    });

    it("rejects invalid definition/block combinations", () => {
        // @ts-expect-error: TypeScript should reject invalid block definitions
        expect(() => new InputBlock(ScaleBlock)).toThrow();
        // @ts-expect-error: ditto
        expect(() => new TransformBlock(NumberInputBlock)).toThrow();
        // @ts-expect-error: ditto
        expect(() => new OutputBlock(ScaleBlock)).toThrow();
    });

    it("rejects invalid configuration", () => {
        expect(() => new TransformBlock(ScaleBlock, { scale: "invalid" as "double" })).toThrow();
    });

    it("can be an output block", () => {
        const block = new OutputBlock(NumberOutputBlock);
        expect(block.definition).toBe(NumberOutputBlock);
    });
});

describe("Connections", () => {
    it("connects ports with the same value type", () => {
        const inputBlock = new InputBlock(NumberInputBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);

        inputBlock.output.connectTo(outputBlock.input);

        expect(outputBlock.input._source).toBe(inputBlock.output);
    });

    it("rejects distinct value type descriptors", () => {
        const inputBlock = new InputBlock(NumberInputBlock);
        const outputBlock = new OutputBlock(OtherNumberOutputBlock);

        expect(() => inputBlock.output.connectTo(outputBlock.input)).toThrow('Cannot connect value type "number" to "number".');
    });

    it("rejects a second source for an input", () => {
        const firstInputBlock = new InputBlock(NumberInputBlock);
        const secondInputBlock = new InputBlock(NumberInputBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);

        firstInputBlock.output.connectTo(outputBlock.input);

        expect(() => secondInputBlock.output.connectTo(outputBlock.input)).toThrow('The input on block "OutputBlock" is already connected.');
    });

    it("rejects a cyclic connection", () => {
        const firstBlock = new TransformBlock(ScaleBlock);
        const secondBlock = new TransformBlock(ScaleBlock);
        const thirdBlock = new TransformBlock(ScaleBlock);

        firstBlock.output.connectTo(secondBlock.input);
        secondBlock.output.connectTo(thirdBlock.input);

        expect(() => thirdBlock.output.connectTo(firstBlock.input)).toThrow();
    });
});

describe("NodeAsset", () => {
    it("resolves switch blocks from each execution input", async () => {
        const inputBlock = new InputBlock(NumberInputBlock);
        const switchBlock = new TransformBlock(ScaleSwitchBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);
        inputBlock.output.connectTo(switchBlock.input);
        switchBlock.output.connectTo(outputBlock.input);
        const nodeAsset = new NodeAsset({ name: "switch", outputBlock });
        const negativeContext = new NodeAssetContext(nodeAsset);
        negativeContext.setInput(inputBlock, -2);
        const positiveContext = new NodeAssetContext(nodeAsset);
        positiveContext.setInput(inputBlock, 2);

        const [negativeResult, positiveResult] = await Promise.all([nodeAsset.executeAsync(negativeContext), nodeAsset.executeAsync(positiveContext)]);

        expect(negativeResult.output).toBe(-4);
        expect(positiveResult.output).toBe(6);
    });

    it("rejects an unconnected output block", () => {
        const outputBlock = new OutputBlock(NumberOutputBlock);

        expect(() => new NodeAsset({ name: "unconnected", outputBlock })).toThrow('The input on block "OutputBlock" is not connected.');
    });

    it("rejects execution without a required input value", async () => {
        const inputBlock = new InputBlock(NumberInputBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);
        inputBlock.output.connectTo(outputBlock.input);
        const nodeAsset = new NodeAsset({ name: "missing-input", outputBlock });

        await expect(nodeAsset.executeAsync()).rejects.toThrow('No value was supplied for input block "InputBlock".');
    });

    it("rejects context inputs outside the node asset", () => {
        const firstInputBlock = new InputBlock(NumberInputBlock, { input: 1 });
        const firstOutputBlock = new OutputBlock(NumberOutputBlock);
        firstInputBlock.output.connectTo(firstOutputBlock.input);
        const firstNodeAsset = new NodeAsset({ name: "first", outputBlock: firstOutputBlock });

        const secondInputBlock = new InputBlock(NumberInputBlock, { input: 2 });
        const secondOutputBlock = new OutputBlock(NumberOutputBlock);
        secondInputBlock.output.connectTo(secondOutputBlock.input);

        const context = new NodeAssetContext(firstNodeAsset);

        expect(() => context.setInput(secondInputBlock, 3)).toThrow('Input block "InputBlock" does not belong to this NodeAsset.');
    });

    it("executes node assets with independent context inputs", async () => {
        const inputBlock = new InputBlock(NumberInputBlock, { input: 2 });
        const scaleBlock = new TransformBlock(ScaleBlock, { scale: "triple" });
        const outputBlock = new OutputBlock(NumberOutputBlock);

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
