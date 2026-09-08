import type { _BlockRuntime } from "../block/block";
import type { ConnectionPointValue } from "../block/connectionPointType";
import type { NodeAssetContext } from "./nodeAssetContext";
import { ResourceScope } from "../resources/resourceScope";

type AnyBlock = _BlockRuntime;

interface ErasedRunner {
    readonly run?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>, auxiliaryInputs: Readonly<Record<string, unknown>>) => unknown;
    readonly runAsync?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>, auxiliaryInputs: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

interface ErasedSourceRunner {
    readonly run?: (config: unknown, resources: Readonly<Record<string, unknown>>, auxiliaryInputs: Readonly<Record<string, unknown>>) => unknown;
    readonly runAsync?: (config: unknown, resources: Readonly<Record<string, unknown>>, auxiliaryInputs: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

interface NodeAssetOptions<TOutput extends AnyBlock> {
    /** The name used to identify the asset. */
    readonly name: string;
    /** The terminal block whose output becomes the execution result. */
    readonly outputBlock: TOutput;
}

interface NodeRecord {
    readonly block: AnyBlock;
    readonly source: AnyBlock | undefined;
    readonly auxiliarySources: Readonly<Record<string, AnyBlock | undefined>>;
}

/** An executable asset pipeline, captured from a terminal output block. */
export class NodeAsset<TOutput extends AnyBlock> {
    readonly #blocks: ReadonlySet<AnyBlock>;
    readonly #consumerCounts: ReadonlyMap<AnyBlock, number>;
    readonly #nodes: readonly NodeRecord[];
    #isDisposed = false;

    public readonly name: string;
    public readonly outputBlock: TOutput;

    public constructor(options: NodeAssetOptions<TOutput>) {
        this.name = options.name;
        this.outputBlock = options.outputBlock;
        this.#nodes = captureTopology(options.outputBlock);
        this.#blocks = new Set(this.#nodes.map(({ block }) => block));
        this.#consumerCounts = countConsumers(this.#nodes);
    }

    /** Executes the captured graph with optional per-execution inputs. */
    public executeAsync(context?: NodeAssetContext<this>): Promise<ConnectionPointValue<TOutput["_definition"]["output"]>> {
        if (this.#isDisposed) {
            return Promise.reject(new Error(`NodeAsset "${this.name}" is disposed.`));
        }
        const inputs = context?._snapshot() ?? new Map<AnyBlock, unknown>();
        return executeAsync(this.#nodes, this.#consumerCounts, this.outputBlock, inputs);
    }

    /** Disposes this node asset without modifying its blocks. */
    public dispose(): void {
        this.#isDisposed = true;
    }

    /** @internal */
    public _hasBlock(block: AnyBlock): boolean {
        return this.#blocks.has(block);
    }
}

function captureTopology(outputBlock: AnyBlock): readonly NodeRecord[] {
    const records: NodeRecord[] = [];
    const visited = new Set<AnyBlock>();
    const visiting = new Set<AnyBlock>();

    const visit = (block: AnyBlock): void => {
        if (visited.has(block)) {
            return;
        }
        if (visiting.has(block)) {
            throw new Error(`NodeAsset contains a cycle at block "${block.name}".`);
        }

        visiting.add(block);
        const source = block.input?._source?._block;
        if (source !== undefined) {
            visit(source);
        }
        const auxiliarySources: Record<string, AnyBlock | undefined> = {};
        for (const [name, input] of Object.entries(block.auxiliaryInputs)) {
            const auxiliarySource = input._source?._block;
            auxiliarySources[name] = auxiliarySource;
            if (auxiliarySource !== undefined) {
                visit(auxiliarySource);
            }
        }
        visiting.delete(block);
        visited.add(block);
        records.push(Object.freeze({ block, source, auxiliarySources: Object.freeze(auxiliarySources) }));
    };

    visit(outputBlock);
    return Object.freeze(records);
}

function countConsumers(nodes: readonly NodeRecord[]): ReadonlyMap<AnyBlock, number> {
    const consumerCounts = new Map<AnyBlock, number>();
    for (const { source, auxiliarySources } of nodes) {
        for (const consumerSource of [source, ...Object.values(auxiliarySources)]) {
            if (consumerSource !== undefined) {
                consumerCounts.set(consumerSource, (consumerCounts.get(consumerSource) ?? 0) + 1);
            }
        }
    }
    return consumerCounts;
}

async function executeAsync<TOutput extends AnyBlock>(
    nodes: readonly NodeRecord[],
    consumerCounts: ReadonlyMap<AnyBlock, number>,
    outputBlock: TOutput,
    contextInputs: ReadonlyMap<AnyBlock, unknown>
): Promise<ConnectionPointValue<TOutput["_definition"]["output"]>> {
    const resourceScope = new ResourceScope();
    const remainingConsumers = new Map(consumerCounts);
    const values = new Map<AnyBlock, unknown>();

    let result: ConnectionPointValue<TOutput["_definition"]["output"]> | undefined;
    let executionError: unknown;
    let executionFailed = false;
    try {
        for (const { block, source, auxiliarySources } of nodes) {
            let input: unknown;
            if (block.input === undefined) {
                input = undefined;
            } else if (source === undefined) {
                input = contextInputs.has(block) ? contextInputs.get(block) : block.input.defaultValue;
                if (input === undefined) {
                    throw new Error(`No value was supplied for block "${block.name}".`);
                }
            } else {
                input = values.get(source);
            }

            if (block._definition.input !== undefined && !block._definition.input.is(input)) {
                throw new Error(`Block "${block.name}" received an invalid input value.`);
            }
            const auxiliaryInputs: Record<string, unknown> = {};
            for (const [name, auxiliarySource] of Object.entries(auxiliarySources)) {
                const auxiliaryInput = auxiliarySource === undefined ? undefined : values.get(auxiliarySource);
                if (auxiliarySource !== undefined && !block._definition.auxiliaryInputs[name]?.is(auxiliaryInput)) {
                    throw new Error(`Block "${block.name}" received an invalid value for auxiliary input "${name}".`);
                }
                auxiliaryInputs[name] = auxiliaryInput;
            }
            const resources = await resourceScope.resolveAllAsync(block._definition.resources);
            let output: unknown;
            if (block._definition.input === undefined) {
                const runner = block._definition as unknown as ErasedSourceRunner;
                output = runner.run === undefined ? await runner.runAsync?.(block._config, resources, auxiliaryInputs) : runner.run(block._config, resources, auxiliaryInputs);
            } else {
                const runner = block._definition as unknown as ErasedRunner;
                output =
                    runner.run === undefined
                        ? await runner.runAsync?.(input, block._config, resources, auxiliaryInputs)
                        : runner.run(input, block._config, resources, auxiliaryInputs);
            }
            if (!block._definition.output.is(output)) {
                throw new Error(`Block "${block.name}" produced an invalid output value.`);
            }
            values.set(block, output);

            for (const consumedSource of [source, ...Object.values(auxiliarySources)]) {
                if (consumedSource !== undefined) {
                    releaseConsumedValue(consumedSource, remainingConsumers, values);
                }
            }
        }

        result = values.get(outputBlock) as ConnectionPointValue<TOutput["_definition"]["output"]>;
    } catch (error) {
        executionError = error;
        executionFailed = true;
    }

    values.clear();
    let disposalError: unknown;
    let disposalFailed = false;
    try {
        await resourceScope.disposeAsync();
    } catch (error) {
        disposalError = error;
        disposalFailed = true;
    }

    if (executionFailed && disposalFailed) {
        const disposalErrors = disposalError instanceof AggregateError ? disposalError.errors : [disposalError];
        throw new AggregateError([executionError, ...disposalErrors], "Execution and resource disposal failed.", { cause: executionError });
    }
    if (executionFailed) {
        throw executionError;
    }
    if (disposalFailed) {
        throw disposalError;
    }
    return result as ConnectionPointValue<TOutput["_definition"]["output"]>;
}

function releaseConsumedValue(source: AnyBlock, remainingConsumers: Map<AnyBlock, number>, values: Map<AnyBlock, unknown>): void {
    const remaining = remainingConsumers.get(source);
    if (remaining === undefined) {
        throw new Error(`Missing consumer count for block "${source.name}".`);
    }
    if (remaining === 1) {
        values.delete(source);
    } else {
        remainingConsumers.set(source, remaining - 1);
    }
}
