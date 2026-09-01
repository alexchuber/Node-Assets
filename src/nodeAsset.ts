import type { BaseBlock, OutputBlock, TransformBlock } from "./blocks/block";
import { _resolveConfig, InputBlock } from "./blocks/block";
import type { _AnyBlockDefinition, ValueOf } from "./blocks/blockDefinition";
import { NodeAssetCoordinator } from "./nodeAssetCoordinator";
import type { _ResourceResolver, ResourceRequirement } from "./resources/resource";

type AnyInputBlock = InputBlock<_AnyBlockDefinition<"input">>;
type AnyTransformBlock = TransformBlock<_AnyBlockDefinition<"transform">>;
type AnyOutputBlock = OutputBlock<_AnyBlockDefinition<"output">>;
type AnyBlock = AnyInputBlock | AnyTransformBlock | AnyOutputBlock;

interface ErasedRunner {
    readonly run?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>) => unknown;
    readonly runAsync?: (input: unknown, config: unknown, resources: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

interface ErasedSwitch {
    readonly resolveBlock?: (input: unknown, config: Readonly<Record<string, unknown>>) => _AnyBlockDefinition | BaseBlock<_AnyBlockDefinition>;
}

interface NodeAssetOptions<TOutput extends AnyOutputBlock> {
    readonly name: string;
    readonly outputBlock: TOutput;
}

interface NodeRecord {
    readonly block: AnyBlock;
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
        for (const { block } of this.#nodes) {
            for (const requirement of Object.values(block.definition.resources)) {
                if (requirement.isEnabled(block.config)) {
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
        records.push(Object.freeze({ block, source }));
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

    for (const { block, source } of nodes) {
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

        if (!block.definition.input.is(input)) {
            throw new Error(`Block "${block.name}" received an invalid input value.`);
        }
        const resolved = resolveRunnableBlock(block, input);
        const resources: Record<string, unknown> = {};
        for (const [name, erasedRequirement] of Object.entries(resolved.definition.resources)) {
            const requirement = erasedRequirement as ResourceRequirement<unknown, unknown>;
            resources[name] = requirement.isEnabled(resolved.config) ? await resolveResource(requirement.definition) : undefined;
        }
        const runner = resolved.definition as unknown as ErasedRunner;
        const output = runner.run === undefined ? await runner.runAsync?.(input, resolved.config, resources) : runner.run(input, resolved.config, resources);
        if (!block.definition.output.is(output)) {
            throw new Error(`Block "${block.name}" produced an invalid output value.`);
        }
        values.set(block, output);
    }

    return new NodeAssetResult(outputBlock, values.get(outputBlock) as ValueOf<TOutput["definition"]["output"]>);
}

function resolveRunnableBlock(block: AnyBlock, input: unknown): { readonly definition: _AnyBlockDefinition; readonly config: Readonly<Record<string, unknown>> } {
    const expectedInput = block.definition.input;
    const expectedOutput = block.definition.output;
    let definition = block.definition;
    let config: Readonly<Record<string, unknown>> = block.config;
    const visited = new Set<_AnyBlockDefinition>();

    while (true) {
        if (visited.has(definition)) {
            throw new Error(`Switch block "${block.name}" contains a resolution cycle.`);
        }
        visited.add(definition);

        const switchDefinition = definition as ErasedSwitch;
        if (switchDefinition.resolveBlock === undefined) {
            if (definition.input !== expectedInput || definition.output !== expectedOutput) {
                throw new Error(`Switch block "${block.name}" resolved an incompatible block.`);
            }
            return { definition, config };
        }

        const target = switchDefinition.resolveBlock(input, config);
        if ("definition" in target) {
            definition = target.definition;
            config = target.config;
        } else {
            definition = target;
            config = _resolveConfig(definition.config, undefined);
        }
    }
}
