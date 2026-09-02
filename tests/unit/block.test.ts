import { describe, expect, it } from "vitest";

import { Block } from "../../src/blocks/block";
import { defineBlock, value } from "../../src/blocks/blockDefinition";
import { NodeAsset } from "../../src/nodeAsset";
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

        await expect(asset.executeAsync()).resolves.toMatchObject({ output: 8 });
    });

    it("uses supplied configuration", async () => {
        const block = new Block(ScaleDefinition, { input: 2, scale: "triple" });
        const asset = new NodeAsset({ name: "configured-scale", outputBlock: block });

        await expect(asset.executeAsync()).resolves.toMatchObject({ output: 6 });
    });

    it("uses configuration defaults", async () => {
        const block = new Block(ScaleDefinition, { input: 2 });
        const asset = new NodeAsset({ name: "default-scale", outputBlock: block });

        await expect(asset.executeAsync()).resolves.toMatchObject({ output: 4 });
    });

    it("rejects invalid configuration", () => {
        expect(() => new Block(ScaleDefinition, { scale: "invalid" as "double" })).toThrow();
    });
});

describe("Block connections", () => {
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
