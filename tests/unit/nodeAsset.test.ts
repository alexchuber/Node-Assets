import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock, defineSourceBlock } from "../../src/block/blockDefinition";
import { NodeAsset, NodeAssetContext } from "../../src/index";
import type { Resource } from "../../src/resources/resource";
import { ScaleDefinition, NumberDefinition } from "../helpers/numberBlocks";

describe("NodeAsset", () => {
    it("treats an unconnected input as a graph input", async () => {
        const block = new Block(ScaleDefinition);
        const nodeAsset = new NodeAsset({ name: "external-input", outputBlock: block });
        const context = new NodeAssetContext(nodeAsset);
        context.setInput(block, 3);

        const result = nodeAsset.executeAsync(context);

        expectTypeOf(result).toEqualTypeOf<Promise<number>>();
        await expect(result).resolves.toBe(6);
    });

    it("rejects execution without a required input value", async () => {
        const block = new Block(NumberDefinition);
        const nodeAsset = new NodeAsset({ name: "missing-input", outputBlock: block });

        await expect(nodeAsset.executeAsync()).rejects.toThrow();
    });

    it("executes a source block without a user input", async () => {
        const valueResource = {
            name: "source-value",
            create: () => 5,
            dispose: () => undefined,
        } satisfies Resource<number>;
        const sourceDefinition = defineSourceBlock({
            type: "source",
            output: NumberDefinition.output,
            resources: { value: valueResource },
            run: (_config, { value }) => value,
        });
        const source = new Block(sourceDefinition);
        const nodeAsset = new NodeAsset({ name: "source", outputBlock: source });

        expectTypeOf(source.input).toEqualTypeOf<undefined>();
        expect(source.input).toBeUndefined();
        await expect(nodeAsset.executeAsync()).resolves.toBe(5);
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

        expect(defaultResult).toBe(6);
        expect(contextResult).toBe(12);
    });

    it("executes connected optional auxiliary inputs", async () => {
        const addDefinition = defineBlock({
            type: "add",
            input: NumberDefinition.input,
            auxiliaryInputs: {
                addend: NumberDefinition.input,
            },
            output: NumberDefinition.output,
            run: (input, _config, _resources, { addend }) => input + (addend ?? 0),
        });
        const addendDefinition = defineSourceBlock({
            type: "addend-source",
            output: NumberDefinition.output,
            run: () => 3,
        });
        const addend = new Block(addendDefinition);
        const add = new Block(addDefinition, { input: 4 });
        add.auxiliaryInputs.addend.connectTo(addend.output);
        const nodeAsset = new NodeAsset({ name: "auxiliary-input", outputBlock: add });

        await expect(nodeAsset.executeAsync()).resolves.toBe(7);
    });

    it("passes undefined for an unconnected optional auxiliary input", async () => {
        let receivedOptional: number | undefined;
        const definition = defineBlock({
            type: "optional-auxiliary-input",
            input: NumberDefinition.input,
            auxiliaryInputs: { optional: NumberDefinition.input },
            output: NumberDefinition.output,
            run: (input, _config, _resources, { optional }) => {
                receivedOptional = optional;
                return input;
            },
        });
        const block = new Block(definition, { input: 4 });

        await expect(new NodeAsset({ name: "optional-auxiliary-input", outputBlock: block }).executeAsync()).resolves.toBe(4);
        expect(receivedOptional).toBeUndefined();
    });

    it("captures auxiliary input topology at construction", async () => {
        const definition = defineBlock({
            type: "captured-auxiliary-input",
            input: NumberDefinition.input,
            auxiliaryInputs: { addend: NumberDefinition.input },
            output: NumberDefinition.output,
            run: (input, _config, _resources, { addend }) => input + (addend ?? 0),
        });
        const source = new Block(NumberDefinition, { input: 3 });
        const destination = new Block(definition, { input: 4 });
        source.output.connectTo(destination.auxiliaryInputs.addend);
        const nodeAsset = new NodeAsset({ name: "captured-auxiliary-input", outputBlock: destination });

        source.output.disconnectFrom(destination.auxiliaryInputs.addend);

        await expect(nodeAsset.executeAsync()).resolves.toBe(7);
    });

    it("allows the same blocks to execute in a new asset after disposal", async () => {
        const source = new Block(NumberDefinition, { input: 2 });
        const output = new Block(NumberDefinition);
        source.output.connectTo(output.input);
        const firstAsset = new NodeAsset({ name: "disposable", outputBlock: output });

        firstAsset.dispose();
        firstAsset.dispose();
        const secondAsset = new NodeAsset({ name: "reused-blocks", outputBlock: output });

        await expect(secondAsset.executeAsync()).resolves.toBe(2);
    });

    it("rejects execution after disposal", async () => {
        const block = new Block(NumberDefinition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "disposed-execution", outputBlock: block });

        nodeAsset.dispose();

        await expect(nodeAsset.executeAsync()).rejects.toThrow();
    });

    it("resolves shared resource dependencies once and disposes dependents first", async () => {
        const events: string[] = [];
        const multiplierResource = {
            name: "multiplier",
            create: () => {
                events.push("create multiplier");
                return 2;
            },
            dispose: () => {
                events.push("dispose multiplier");
            },
        } satisfies Resource<number>;
        const calculatorResource = {
            name: "calculator",
            dependencies: { multiplier: multiplierResource },
            create: ({ multiplier }) => {
                expectTypeOf(multiplier).toEqualTypeOf<number>();
                events.push("create calculator");
                return (value: number) => value * multiplier;
            },
            dispose: () => {
                events.push("dispose calculator");
            },
        } satisfies Resource<(value: number) => number, { readonly multiplier: typeof multiplierResource }>;
        let calculatorsWereShared = false;
        const definition = defineBlock({
            type: "resource-consumer",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            resources: {
                calculator: calculatorResource,
                sameCalculator: calculatorResource,
            },
            run: (input, _config, { calculator, sameCalculator }) => {
                expectTypeOf(calculator).toEqualTypeOf<(value: number) => number>();
                calculatorsWereShared = calculator === sameCalculator;
                events.push("run");
                return calculator(input);
            },
        });
        const block = new Block(definition, { input: 3 });
        const nodeAsset = new NodeAsset({ name: "resources", outputBlock: block });

        await expect(nodeAsset.executeAsync()).resolves.toBe(6);
        expect(calculatorsWereShared).toBe(true);
        expect(events).toEqual(["create multiplier", "create calculator", "run", "dispose calculator", "dispose multiplier"]);
    });

    it("isolates resources between concurrent executions", async () => {
        let nextId = 0;
        const disposedIds: number[] = [];
        const resource = {
            name: "execution-resource",
            create: () => ({ id: ++nextId }),
            dispose: ({ id }) => {
                disposedIds.push(id);
            },
        } satisfies Resource<{ id: number }>;
        const definition = defineBlock({
            type: "execution-resource-consumer",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            resources: { resource },
            run: (_input, _config, { resource: { id } }) => id,
        });
        const block = new Block(definition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "isolated-resources", outputBlock: block });

        expect(nextId).toBe(0);
        const results = await Promise.all([nodeAsset.executeAsync(), nodeAsset.executeAsync()]);

        expect(results.sort()).toEqual([1, 2]);
        expect(disposedIds.sort()).toEqual([1, 2]);
    });

    it("disposes acquired dependencies when resource creation fails", async () => {
        const disposeDependency = vi.fn();
        const disposeFailedResource = vi.fn();
        const dependency = {
            name: "acquired-dependency",
            create: () => ({}),
            dispose: disposeDependency,
        } satisfies Resource<object>;
        const failingResource = {
            name: "failing-resource",
            dependencies: { dependency },
            create: () => {
                throw new Error("resource creation failed");
            },
            dispose: disposeFailedResource,
        } satisfies Resource<object, { readonly dependency: typeof dependency }>;
        const definition = defineBlock({
            type: "failing-resource-consumer",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            resources: { failingResource },
            run: (input) => input,
        });
        const block = new Block(definition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "resource-creation-failure", outputBlock: block });

        await expect(nodeAsset.executeAsync()).rejects.toThrow();
        expect(disposeDependency).toHaveBeenCalledOnce();
        expect(disposeFailedResource).not.toHaveBeenCalled();
    });

    it("attempts every resource disposal when cleanup fails", async () => {
        const disposeFirst = vi.fn();
        const disposeSecond = vi.fn(() => {
            throw new Error("resource cleanup failed");
        });
        const firstResource = {
            name: "first-resource",
            create: () => ({}),
            dispose: disposeFirst,
        } satisfies Resource<object>;
        const secondResource = {
            name: "second-resource",
            create: () => ({}),
            dispose: disposeSecond,
        } satisfies Resource<object>;
        const definition = defineBlock({
            type: "cleanup-failure-consumer",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            resources: { firstResource, secondResource },
            run: (input) => input,
        });
        const block = new Block(definition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "resource-cleanup-failure", outputBlock: block });

        await expect(nodeAsset.executeAsync()).rejects.toThrow();
        expect(disposeFirst).toHaveBeenCalledOnce();
        expect(disposeSecond).toHaveBeenCalledOnce();
    });

    it("preserves execution and cleanup failures", async () => {
        const executionError = new Error("execution failed");
        const cleanupError = new Error("cleanup failed");
        const resource = {
            name: "failing-cleanup",
            create: () => ({}),
            dispose: () => {
                throw cleanupError;
            },
        } satisfies Resource<object>;
        const definition = defineBlock({
            type: "execution-and-cleanup-failure",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            resources: { resource },
            run: () => {
                throw executionError;
            },
        });
        const block = new Block(definition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "execution-and-cleanup-failure", outputBlock: block });

        const error = await nodeAsset.executeAsync().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([executionError, cleanupError]);
    });

    it("rejects cyclic resource dependencies", async () => {
        interface CyclicDependencies {
            readonly [name: string]: Resource<object, CyclicDependencies>;
        }

        const firstResource = {
            name: "first-cyclic-resource",
            dependencies: {} as CyclicDependencies,
            create: () => ({}),
            dispose: () => undefined,
        } satisfies Resource<object, CyclicDependencies>;
        const secondResource = {
            name: "second-cyclic-resource",
            dependencies: { firstResource },
            create: () => ({}),
            dispose: () => undefined,
        } satisfies Resource<object, { readonly firstResource: typeof firstResource }>;
        firstResource.dependencies = { secondResource } as CyclicDependencies;
        const definition = defineBlock({
            type: "cyclic-resource-consumer",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            resources: { firstResource },
            run: (input) => input,
        });
        const block = new Block(definition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "cyclic-resources", outputBlock: block });

        await expect(nodeAsset.executeAsync()).rejects.toThrow();
    });
});
