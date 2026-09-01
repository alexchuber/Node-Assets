import type { BaseBlock, OutputBlock, TransformBlock } from "./blocks/block";
import { InputBlock } from "./blocks/block";
import type { _AnyBlockDefinition, ValueOf } from "./blocks/blockDefinition";
import { NodeAssetCoordinator } from "./nodeAssetCoordinator";
import type { _ResourceResolver, ResourceRequirement } from "./resources/resource";
import { _isRoutedOutputDefinition, _resolveRoute } from "./routePlanner";

type AnyInputBlock = InputBlock<_AnyBlockDefinition<"input">>;
type AnyTransformBlock = TransformBlock<_AnyBlockDefinition<"transform">>;
type AnyOutputBlock = OutputBlock<_AnyBlockDefinition<"output">>;
type AnyBlock = AnyInputBlock | AnyTransformBlock | AnyOutputBlock;

interface ErasedRunner {
    readonly run?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>) => unknown;
    readonly runAsync?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

interface NodeAssetOptions<TOutput extends AnyOutputBlock> {
    readonly name: string;
    readonly outputBlock: TOutput;
}

interface NodeRecord {
    readonly block: AnyBlock;
    readonly runner: BaseBlock<_AnyBlockDefinition> | undefined;
    readonly source: AnyBlock | undefined;
}

export class NodeAsset<TOutput extends AnyOutputBlock> {
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

    public async executeAsync(context?: NodeAssetContext<this>): Promise<NodeAssetResult<TOutput>> {
        const coordinator = new NodeAssetCoordinator();
        try {
            return await coordinator.executeAsync(this, context);
        } finally {
            await coordinator.disposeAsync();
        }
    }

    /** @internal */
    public async _prepareAsync(resolveResource: _ResourceResolver): Promise<void> {
        const pending: Promise<unknown>[] = [];
        for (const { runner } of this.#nodes) {
            if (runner === undefined) {
                continue;
            }
            for (const requirement of Object.values(runner.definition.resources)) {
                if (requirement.isEnabled(runner.config)) {
                    pending.push(resolveResource(requirement.definition));
                }
            }
        }
        await Promise.all(pending);
    }

    /** @internal */
    public _executeAsync(context: NodeAssetContext<this> | undefined, resolveResource: _ResourceResolver): Promise<NodeAssetResult<TOutput>> {
        const inputs = context?._snapshot() ?? new Map<AnyInputBlock, unknown>();
        return executeAsync(this.#nodes, this.outputBlock, inputs, resolveResource);
    }

    /** @internal */
    public _hasBlock(block: AnyBlock): boolean {
        return this.#blocks.has(block);
    }
}

export class NodeAssetContext<TAsset extends NodeAsset<AnyOutputBlock>> {
    readonly #asset: TAsset;
    readonly #inputs = new Map<AnyInputBlock, unknown>();

    public constructor(asset: TAsset) {
        this.#asset = asset;
    }

    public setInput<TDefinition extends _AnyBlockDefinition<"input">>(block: InputBlock<TDefinition>, value: ValueOf<TDefinition["input"]>): void {
        if (!this.#asset._hasBlock(block)) {
            throw new Error(`Input block "${block.name}" does not belong to this NodeAsset.`);
        }
        if (!block.definition.input.is(value)) {
            throw new Error(`Input block "${block.name}" expected value type "${block.definition.input.id}".`);
        }
        this.#inputs.set(block, value);
    }

    /** @internal */
    public _snapshot(): Map<AnyInputBlock, unknown> {
        return new Map(this.#inputs);
    }
}

export class NodeAssetResult<TOutput extends AnyOutputBlock> {
    public constructor(
        public readonly outputBlock: TOutput,
        public readonly output: ValueOf<TOutput["definition"]["output"]>
    ) {}
}

function captureTopology(outputBlock: AnyOutputBlock): readonly NodeRecord[] {
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
        const source = (block instanceof InputBlock ? undefined : block.input._source?._block) as AnyBlock | undefined;
        if (!(block instanceof InputBlock) && source === undefined) {
            throw new Error(`The input on block "${block.name}" is not connected.`);
        }
        if (source !== undefined) {
            visit(source);
        }
        visiting.delete(block);
        visited.add(block);
        if (_isRoutedOutputDefinition(block.definition)) {
            if (source === undefined) {
                throw new Error(`The input on block "${block.name}" is not connected.`);
            }
            const route = _resolveRoute(block.definition, source.definition.output, block.config);
            if (route.length === 0) {
                records.push(Object.freeze({ block, runner: undefined, source }));
            } else {
                let routeSource = source;
                for (let index = 0; index < route.length; index += 1) {
                    const runner = route[index];
                    if (runner === undefined) {
                        continue;
                    }
                    const routeBlock = runner as AnyBlock;
                    const valueBlock = index === route.length - 1 ? block : routeBlock;
                    records.push(Object.freeze({ block: valueBlock, runner, source: routeSource }));
                    routeSource = valueBlock;
                }
            }
        } else {
            records.push(Object.freeze({ block, runner: block, source }));
        }
    };

    visit(outputBlock);
    return Object.freeze(records);
}

async function executeAsync<TOutput extends AnyOutputBlock>(
    nodes: readonly NodeRecord[],
    outputBlock: TOutput,
    contextInputs: ReadonlyMap<AnyInputBlock, unknown>,
    resolveResource: _ResourceResolver
): Promise<NodeAssetResult<TOutput>> {
    const values = new Map<AnyBlock, unknown>();

    for (const { block, runner, source } of nodes) {
        let input: unknown;
        if (block instanceof InputBlock) {
            input = contextInputs.has(block) ? contextInputs.get(block) : block.defaultInput;
            if (input === undefined) {
                throw new Error(`No value was supplied for input block "${block.name}".`);
            }
        } else {
            if (source === undefined) {
                throw new Error(`The input on block "${block.name}" is not connected.`);
            }
            input = values.get(source);
        }

        if (runner === undefined) {
            if (!block.definition.output.is(input)) {
                throw new Error(`Block "${block.name}" received an invalid routed output value.`);
            }
            values.set(block, input);
            continue;
        }
        if (!runner.definition.input.is(input)) {
            throw new Error(`Block "${block.name}" received an invalid input value.`);
        }
        const resources: Record<string, unknown> = {};
        for (const [name, erasedRequirement] of Object.entries(runner.definition.resources)) {
            const requirement = erasedRequirement as ResourceRequirement<unknown, unknown>;
            resources[name] = requirement.isEnabled(runner.config) ? await resolveResource(requirement.definition) : undefined;
        }
        const erasedRunner = runner.definition as unknown as ErasedRunner;
        const output = erasedRunner.run === undefined ? await erasedRunner.runAsync?.(input, runner.config, resources) : erasedRunner.run(input, runner.config, resources);
        if (!runner.definition.output.is(output) || !block.definition.output.is(output)) {
            throw new Error(`Block "${block.name}" produced an invalid output value.`);
        }
        values.set(block, output);
    }

    return new NodeAssetResult(outputBlock, values.get(outputBlock) as ValueOf<TOutput["definition"]["output"]>);
}
