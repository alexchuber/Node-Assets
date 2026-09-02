import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock } from "../../src/block/blockDefinition";
import { NodeAsset, NodeAssetContext } from "../../src/index";
import type { Resource } from "../../src/resources/resource";
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

    it("releases intermediate outputs after their final consumer", async () => {
        const source = new Block(NumberDefinition, { input: 2 });
        const scale = new Block(ScaleDefinition);
        const deleteSpy = vi.spyOn(Map.prototype, "delete");
        const outputDefinition = defineBlock({
            type: "release-observer",
            input: NumberDefinition.input,
            output: NumberDefinition.output,
            run: (input) => {
                expect(deleteSpy.mock.calls.some(([key]) => key === source)).toBe(true);
                return input;
            },
        });
        const output = new Block(outputDefinition);
        source.output.connectTo(scale.input);
        scale.output.connectTo(output.input);
        const nodeAsset = new NodeAsset({ name: "bounded-values", outputBlock: output });

        try {
            await expect(nodeAsset.executeAsync()).resolves.toMatchObject({ output: 4 });
            const releasedBlocks = deleteSpy.mock.calls.map(([key]) => key).filter((key) => key === source || key === scale || key === output);
            expect(releasedBlocks).toEqual([source, scale]);
        } finally {
            deleteSpy.mockRestore();
        }
    });

    it("disposes only the connections captured by the node asset", () => {
        const source = new Block(NumberDefinition, { input: 2 });
        const output = new Block(NumberDefinition);
        const unrelated = new Block(NumberDefinition);
        source.output.connectTo(output.input);
        source.output.connectTo(unrelated.input);
        const nodeAsset = new NodeAsset({ name: "disposable", outputBlock: output });

        nodeAsset.dispose();
        nodeAsset.dispose();

        expect(output.input._source).toBeUndefined();
        expect(unrelated.input._source).toBe(source.output);
        expect(source.output._endpoints).toEqual(new Set([unrelated.input]));
    });

    it("preserves connections that replaced a captured edge", () => {
        const capturedSource = new Block(NumberDefinition);
        const replacementSource = new Block(NumberDefinition);
        const output = new Block(NumberDefinition);
        capturedSource.output.connectTo(output.input);
        const nodeAsset = new NodeAsset({ name: "reconnected", outputBlock: output });
        capturedSource.output.disconnectFrom(output.input);
        replacementSource.output.connectTo(output.input);

        nodeAsset.dispose();

        expect(output.input._source).toBe(replacementSource.output);
        expect(replacementSource.output._endpoints).toContain(output.input);
    });

    it("rejects execution after disposal", async () => {
        const block = new Block(NumberDefinition, { input: 1 });
        const nodeAsset = new NodeAsset({ name: "disposed-execution", outputBlock: block });

        nodeAsset.dispose();

        await expect(nodeAsset.executeAsync()).rejects.toThrow('NodeAsset "disposed-execution" is disposed.');
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
                expect(calculator).toBe(sameCalculator);
                events.push("run");
                return calculator(input);
            },
        });
        const block = new Block(definition, { input: 3 });
        const nodeAsset = new NodeAsset({ name: "resources", outputBlock: block });

        await expect(nodeAsset.executeAsync()).resolves.toMatchObject({ output: 6 });
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

        expect(results.map(({ output }) => output).sort()).toEqual([1, 2]);
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
