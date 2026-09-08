import { describe, expect, it } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock, value } from "../../src/block/blockDefinition";
import { NodeAsset } from "../../src/nodeAsset/nodeAsset";
import { ScaleDefinition, NumberDefinition, OtherNumberDefinition, NumberType } from "../helpers/numberBlocks";

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
    it("uses a connected source during execution", async () => {
        const source = new Block(NumberDefinition, { input: 3 });
        const destination = new Block(ScaleDefinition);

        source.output.connectTo(destination.input);

        await expect(new NodeAsset({ name: "connected-source", outputBlock: destination }).executeAsync()).resolves.toBe(6);
    });

    it("rejects distinct connection point type descriptors", () => {
        const inputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(OtherNumberDefinition);

        expect(() => inputBlock.output.connectTo(outputBlock.input)).toThrow();
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

        expect(() => destination.auxiliaryInputs.value.connectTo(source.output)).toThrow();
    });

    it("rejects a second source for an input", () => {
        const firstInputBlock = new Block(NumberDefinition);
        const secondInputBlock = new Block(NumberDefinition);
        const outputBlock = new Block(NumberDefinition);

        firstInputBlock.output.connectTo(outputBlock.input);

        expect(() => secondInputBlock.output.connectTo(outputBlock.input)).toThrow();
    });

    it("disconnects from the output side before connecting a different source", async () => {
        const firstSource = new Block(NumberDefinition);
        const secondSource = new Block(NumberDefinition, { input: 3 });
        const destination = new Block(ScaleDefinition);

        firstSource.output.connectTo(destination.input);
        firstSource.output.disconnectFrom(destination.input);
        firstSource.output.disconnectFrom(destination.input);
        secondSource.output.connectTo(destination.input);

        await expect(new NodeAsset({ name: "output-side-disconnect", outputBlock: destination }).executeAsync()).resolves.toBe(6);
    });

    it("connects and disconnects equivalently from the input side", async () => {
        const firstSource = new Block(NumberDefinition);
        const secondSource = new Block(NumberDefinition, { input: 4 });
        const destination = new Block(ScaleDefinition);

        destination.input.connectTo(firstSource.output);
        destination.input.disconnectFrom(firstSource.output);
        destination.input.disconnectFrom(firstSource.output);
        destination.input.connectTo(secondSource.output);

        await expect(new NodeAsset({ name: "input-side-disconnect", outputBlock: destination }).executeAsync()).resolves.toBe(8);
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
