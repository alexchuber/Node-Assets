import { describe, expect, it } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock, value } from "../../src/block/blockDefinition";
import { NodeAsset } from "../../src/nodeAsset/nodeAsset";
import { ScaleDefinition, NumberDefinition, OtherNumberDefinition, NumberType } from "../fixtures/numberBlocks";

describe("Block definition", () => {
    it("freezes definitions and configuration descriptors", () => {
        expect(Object.isFrozen(ScaleDefinition)).toBe(true);
        expect(Object.isFrozen(ScaleDefinition.config)).toBe(true);
        expect(Object.isFrozen(ScaleDefinition.config.scale)).toBe(true);
    });
});

describe("Block class", () => {
    it("has input and output ports", () => {
        const block = new Block(NumberDefinition, { name: "Source", input: 5 });
        expect(block.name).toBe("Source");
        expect(block.input.defaultValue).toBe(5);
        expect(block.input.type).toBe(NumberType);
        expect(block.output.type).toBe(NumberType);
    });

    it("can have a config value named the same as a property", async () => {
        const WeirdNumberDefinition = defineBlock({
            type: "weird-number",
            input: NumberType,
            output: NumberType,
            config: {
                defaultInput: value(NumberType, 3),
            },
            run: (input, config) => input + config.defaultInput,
        });

        const block = new Block(WeirdNumberDefinition, { input: 5 });
        const asset = new NodeAsset({ name: "weird-number", outputBlock: block });

        await expect(asset.executeAsync()).resolves.toBe(8);
    });

    it("uses supplied configuration", async () => {
        const block = new Block(ScaleDefinition, { input: 2, scale: "triple" });
        const asset = new NodeAsset({ name: "configured-scale", outputBlock: block });

        await expect(asset.executeAsync()).resolves.toBe(6);
    });

    it("uses configuration defaults", async () => {
        const block = new Block(ScaleDefinition, { input: 2 });
        const asset = new NodeAsset({ name: "default-scale", outputBlock: block });

        await expect(asset.executeAsync()).resolves.toBe(4);
    });

    it("rejects invalid configuration", () => {
        expect(() => new Block(ScaleDefinition, { scale: "invalid" as "double" })).toThrow();
    });
});

describe("Block connections", () => {
    it("connects ports with the same connection point type", () => {
        const inputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(NumberDefinition);

        outputBlock.input.connectTo(inputBlock.output);

        expect(outputBlock.input._source).toBe(inputBlock.output);
    });

    it("rejects distinct connection point type descriptors", () => {
        const inputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(OtherNumberDefinition);

        expect(() => inputBlock.output.connectTo(outputBlock.input)).toThrow('Cannot connect connection point type "number" to "number".');
    });

    it("validates auxiliary input connection point types", () => {
        const definition = defineBlock({
            type: "auxiliary-input",
            input: NumberType,
            auxiliaryInputs: { value: OtherNumberDefinition.input },
            output: NumberType,
            run: (input) => input,
        });
        const source = new Block(NumberDefinition);
        const destination = new Block(definition);

        expect(() => destination.auxiliaryInputs.value.connectTo(source.output)).toThrow('Cannot connect connection point type "number" to "number".');
    });

    it("rejects a second source for an input", () => {
        const firstInputBlock = new Block(NumberDefinition);
        const secondInputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(NumberDefinition);

        firstInputBlock.output.connectTo(outputBlock.input);

        expect(() => secondInputBlock.output.connectTo(outputBlock.input)).toThrow();
    });

    it("disconnects an output from an input", () => {
        const firstSource = new Block(NumberDefinition);
        const secondSource = new Block(NumberDefinition);
        const destination = new Block(NumberDefinition);

        firstSource.output.connectTo(destination.input);
        firstSource.output.disconnectFrom(destination.input);
        firstSource.output.disconnectFrom(destination.input);
        secondSource.output.connectTo(destination.input);

        expect(destination.input._source).toBe(secondSource.output);
        expect(firstSource.output._endpoints).not.toContain(destination.input);
    });

    it("disconnects an input from an output", () => {
        const connectedSource = new Block(NumberDefinition);
        const destination = new Block(NumberDefinition);

        connectedSource.output.connectTo(destination.input);
        destination.input.disconnectFrom(connectedSource.output);

        expect(destination.input._source).toBeUndefined();
        expect(connectedSource.output._endpoints).not.toContain(destination.input);
    });

    it("excludes disconnected edges from cycle detection", () => {
        const firstBlock = new Block(ScaleDefinition);
        const secondBlock = new Block(ScaleDefinition);

        firstBlock.output.connectTo(secondBlock.input);
        firstBlock.output.disconnectFrom(secondBlock.input);

        expect(() => secondBlock.output.connectTo(firstBlock.input)).not.toThrow();
    });

    it("rejects a cyclic connection", () => {
        const firstBlock = new Block(ScaleDefinition);
        const secondBlock = new Block(ScaleDefinition);
        const thirdBlock = new Block(ScaleDefinition);

        firstBlock.output.connectTo(secondBlock.input);
        secondBlock.output.connectTo(thirdBlock.input);

        expect(() => thirdBlock.output.connectTo(firstBlock.input)).toThrow();
    });

    it("includes auxiliary inputs in cycle detection", () => {
        const definition = defineBlock({
            type: "auxiliary-cycle",
            input: NumberType,
            auxiliaryInputs: { value: NumberType },
            output: NumberType,
            run: (input) => input,
        });
        const firstBlock = new Block(definition);
        const secondBlock = new Block(definition);

        firstBlock.output.connectTo(secondBlock.auxiliaryInputs.value);

        expect(() => secondBlock.output.connectTo(firstBlock.input)).toThrow();
    });
});
