import type { Block } from "./blocks/block";
import type { _AnyBlockDefinition } from "./blocks/blockDefinition";
import type { ConnectionPointValue } from "./connectionPointType";
import type { NodeAssetContext } from "./nodeAssetContext";
import { NodeAssetResult } from "./nodeAssetResult";

type AnyBlock = Block<_AnyBlockDefinition>;

interface ErasedRunner {
    readonly run?: (input: unknown, config: unknown) => unknown;
    readonly runAsync?: (input: unknown, config: unknown) => Promise<unknown>;
}

interface NodeAssetOptions<TOutput extends AnyBlock> {
    readonly name: string;
    readonly outputBlock: TOutput;
}

interface NodeRecord {
    readonly block: AnyBlock;
    readonly source: AnyBlock | undefined;
}

export class NodeAsset<TOutput extends AnyBlock> {
    readonly #blocks: ReadonlySet<AnyBlock>;
    readonly #nodes: readonly NodeRecord[];

    public readonly name: string;
    public readonly outputBlock: TOutput;

    public constructor(options: NodeAssetOptions<TOutput>) {
        this.name = options.name;
        this.outputBlock = options.outputBlock;
        this.#nodes = captureTopology(options.outputBlock);
        this.#blocks = new Set(this.#nodes.map(({ block }) => block));
    }

    public executeAsync(context?: NodeAssetContext<this>): Promise<NodeAssetResult<TOutput>> {
        const inputs = context?._snapshot() ?? new Map<AnyBlock, unknown>();
        return executeAsync(this.#nodes, this.outputBlock, inputs);
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

async function executeAsync<TOutput extends AnyBlock>(
    nodes: readonly NodeRecord[],
    outputBlock: TOutput,
    contextInputs: ReadonlyMap<AnyBlock, unknown>
): Promise<NodeAssetResult<TOutput>> {
    const values = new Map<AnyBlock, unknown>();

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
        const output = runner.run === undefined ? await runner.runAsync?.(input, block._config) : runner.run(input, block._config);
        if (!block._definition.output.is(output)) {
            throw new Error(`Block "${block.name}" produced an invalid output value.`);
        }
        values.set(block, output);
    }

    return new NodeAssetResult(outputBlock, values.get(outputBlock) as ConnectionPointValue<TOutput["_definition"]["output"]>);
}
