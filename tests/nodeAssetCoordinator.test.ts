import { describe, expect, it } from "vitest";

import { InputBlock, OutputBlock, TransformBlock } from "../src/blocks/block";
import { defineInputBlock, defineOutputBlock, defineTransformBlock, defineValueType, enumValue } from "../src/blocks/blockDefinition";
import { conditionalResource, defineResource, resource } from "../src/resources/resource";
import { NodeAsset, NodeAssetContext, NodeAssetCoordinator } from "../src/index";

const NumberType = defineValueType<number>("number", (value): value is number => typeof value === "number");

const NumberInputBlock = defineInputBlock({
    type: "number-input",
    input: NumberType,
    output: NumberType,
    run: (input) => input,
});

const NumberOutputBlock = defineOutputBlock({
    type: "number-output",
    input: NumberType,
    output: NumberType,
    run: (input) => input,
});

describe("NodeAssetCoordinator", () => {
    it("prepares, reuses, and disposes block resources", async () => {
        let createCount = 0;
        let disposeCount = 0;
        const MultiplierResource = defineResource({
            id: "multiplier",
            createAsync: async () => {
                createCount += 1;
                return 3;
            },
            disposeAsync: async () => {
                disposeCount += 1;
            },
        });
        const MultiplyBlock = defineTransformBlock({
            type: "multiply",
            input: NumberType,
            output: NumberType,
            resources: {
                multiplier: resource(MultiplierResource),
            },
            run: (input, _config, resources) => input * resources.multiplier,
        });

        const inputBlock = new InputBlock(NumberInputBlock);
        const multiplyBlock = new TransformBlock(MultiplyBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);
        inputBlock.output.connectTo(multiplyBlock.input);
        multiplyBlock.output.connectTo(outputBlock.input);
        const nodeAsset = new NodeAsset({ name: "multiply", outputBlock });
        const firstContext = new NodeAssetContext(nodeAsset);
        firstContext.setInput(inputBlock, 2);
        const secondContext = new NodeAssetContext(nodeAsset);
        secondContext.setInput(inputBlock, 4);

        const coordinator = new NodeAssetCoordinator();
        await coordinator.prepareAsync(nodeAsset);
        const results = await coordinator.executeAsync(nodeAsset, [firstContext, secondContext]);
        await coordinator.disposeAsync();

        expect(results.map(({ output }) => output)).toEqual([6, 12]);
        expect(createCount).toBe(1);
        expect(disposeCount).toBe(1);
    });

    it("does not acquire a disabled conditional resource", async () => {
        let createCount = 0;
        const MultiplierResource = defineResource({
            id: "conditional-multiplier",
            createAsync: async () => {
                createCount += 1;
                return 3;
            },
        });
        const MaybeMultiplyBlock = defineTransformBlock({
            type: "maybe-multiply",
            input: NumberType,
            output: NumberType,
            config: {
                mode: enumValue(["disabled", "enabled"], "disabled"),
            },
            resources: {
                multiplier: conditionalResource(MultiplierResource, (config) => config.mode === "enabled"),
            },
            run: (input, _config, resources) => input * (resources.multiplier ?? 1),
        });

        const inputBlock = new InputBlock(NumberInputBlock, { input: 2 });
        const multiplyBlock = new TransformBlock(MaybeMultiplyBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);
        inputBlock.output.connectTo(multiplyBlock.input);
        multiplyBlock.output.connectTo(outputBlock.input);
        const nodeAsset = new NodeAsset({ name: "maybe-multiply", outputBlock });
        const coordinator = new NodeAssetCoordinator();

        const result = await coordinator.executeAsync(nodeAsset);
        await coordinator.disposeAsync();

        expect(result.output).toBe(2);
        expect(createCount).toBe(0);
    });

    it("disposes resources used by one-shot execution", async () => {
        let disposeCount = 0;
        const MultiplierResource = defineResource({
            id: "one-shot-multiplier",
            createAsync: async () => 2,
            disposeAsync: async () => {
                disposeCount += 1;
            },
        });
        const MultiplyBlock = defineTransformBlock({
            type: "one-shot-multiply",
            input: NumberType,
            output: NumberType,
            resources: {
                multiplier: resource(MultiplierResource),
            },
            run: (input, _config, resources) => input * resources.multiplier,
        });

        const inputBlock = new InputBlock(NumberInputBlock, { input: 3 });
        const multiplyBlock = new TransformBlock(MultiplyBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);
        inputBlock.output.connectTo(multiplyBlock.input);
        multiplyBlock.output.connectTo(outputBlock.input);
        const nodeAsset = new NodeAsset({ name: "one-shot", outputBlock });

        const result = await nodeAsset.executeAsync();

        expect(result.output).toBe(6);
        expect(disposeCount).toBe(1);
    });

    it("shares dependencies between resources and disposes dependents first", async () => {
        let workerCreateCount = 0;
        const disposalOrder: string[] = [];
        const WorkerResource = defineResource({
            id: "worker",
            createAsync: async () => {
                workerCreateCount += 1;
                return 2;
            },
            disposeAsync: async () => {
                disposalOrder.push("worker");
            },
        });
        const MultiplierResource = defineResource({
            id: "dependent-multiplier",
            createAsync: async (resolveResource) => (await resolveResource(WorkerResource)) * 2,
            disposeAsync: async () => {
                disposalOrder.push("multiplier");
            },
        });
        const MultiplyBlock = defineTransformBlock({
            type: "dependent-multiply",
            input: NumberType,
            output: NumberType,
            resources: {
                multiplier: resource(MultiplierResource),
                worker: resource(WorkerResource),
            },
            run: (input, _config, resources) => input * resources.multiplier + resources.worker,
        });

        const inputBlock = new InputBlock(NumberInputBlock, { input: 2 });
        const multiplyBlock = new TransformBlock(MultiplyBlock);
        const outputBlock = new OutputBlock(NumberOutputBlock);
        inputBlock.output.connectTo(multiplyBlock.input);
        multiplyBlock.output.connectTo(outputBlock.input);
        const nodeAsset = new NodeAsset({ name: "dependent-resources", outputBlock });
        const coordinator = new NodeAssetCoordinator();

        const result = await coordinator.executeAsync(nodeAsset);
        await coordinator.disposeAsync();

        expect(result.output).toBe(10);
        expect(workerCreateCount).toBe(1);
        expect(disposalOrder).toEqual(["multiplier", "worker"]);
    });
});
