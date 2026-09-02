import type { Block } from "../block/block";
import type { _AnyBlockDefinition } from "../block/blockDefinition";
import type { ConnectionPointValue } from "../block/connectionPointType";
import type { NodeAssetContext } from "./nodeAssetContext";
import { NodeAssetResult } from "./nodeAssetResult";
import { ResourceScope } from "../resources/resourceScope";

type AnyBlock = Block<_AnyBlockDefinition>;

interface ErasedRunner {
    readonly run?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>) => unknown;
    readonly runAsync?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>) => Promise<unknown>;
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
    public executeAsync(context?: NodeAssetContext<this>): Promise<NodeAssetResult<TOutput>> {
        if (this.#isDisposed) {
            return Promise.reject(new Error(`NodeAsset "${this.name}" is disposed.`));
        }
        const inputs = context?._snapshot() ?? new Map<AnyBlock, unknown>();
        return executeAsync(this.#nodes, this.#consumerCounts, this.outputBlock, inputs);
    }

    /** Releases the connections captured by this node asset. */
    public dispose(): void {
        if (this.#isDisposed) {
            return;
        }
        this.#isDisposed = true;

        for (const { block, source } of this.#nodes) {
            source?.output.disconnectFrom(block.input);
        }
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
        const source = block.input._source?._block;
        if (source !== undefined) {
            visit(source);
        }
        visiting.delete(block);
        visited.add(block);
        records.push(Object.freeze({ block, source }));
    };

    visit(outputBlock);
    return Object.freeze(records);
}

function countConsumers(nodes: readonly NodeRecord[]): ReadonlyMap<AnyBlock, number> {
    const consumerCounts = new Map<AnyBlock, number>();
    for (const { source } of nodes) {
        if (source !== undefined) {
            consumerCounts.set(source, (consumerCounts.get(source) ?? 0) + 1);
        }
    }
    return consumerCounts;
}

async function executeAsync<TOutput extends AnyBlock>(
    nodes: readonly NodeRecord[],
    consumerCounts: ReadonlyMap<AnyBlock, number>,
    outputBlock: TOutput,
    contextInputs: ReadonlyMap<AnyBlock, unknown>
): Promise<NodeAssetResult<TOutput>> {
    const resourceScope = new ResourceScope();
    const remainingConsumers = new Map(consumerCounts);
    const values = new Map<AnyBlock, unknown>();

    try {
        for (const { block, source } of nodes) {
            let input: unknown;
            if (source === undefined) {
                input = contextInputs.has(block) ? contextInputs.get(block) : block.input.defaultValue;
                if (input === undefined) {
                    throw new Error(`No value was supplied for block "${block.name}".`);
                }
            } else {
                input = values.get(source);
            }

            if (!block._definition.input.is(input)) {
                throw new Error(`Block "${block.name}" received an invalid input value.`);
            }
            const runner = block._definition as unknown as ErasedRunner;
            const resources = await resourceScope.resolveAllAsync(block._definition.resources);
            const output = runner.run === undefined ? await runner.runAsync?.(input, block._config, resources) : runner.run(input, block._config, resources);
            if (!block._definition.output.is(output)) {
                throw new Error(`Block "${block.name}" produced an invalid output value.`);
            }
            values.set(block, output);

            if (source !== undefined) {
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
        }

        return new NodeAssetResult(outputBlock, values.get(outputBlock) as ConnectionPointValue<TOutput["_definition"]["output"]>);
    } finally {
        values.clear();
        await resourceScope.disposeAsync();
    }
}
