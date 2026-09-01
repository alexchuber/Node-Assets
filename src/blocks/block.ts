import type { _AnyBlockDefinition, ConfigDefinition, ConfigValues, ValueOf, ValueType } from "./blockDefinition";

export type BlockOptions<TDefinition extends _AnyBlockDefinition> = Partial<ConfigValues<TDefinition["config"]>> & {
    readonly name?: string;
};

export type InputBlockOptions<TDefinition extends _AnyBlockDefinition<"input">> = BlockOptions<TDefinition> & {
    readonly input?: ValueOf<TDefinition["input"]>;
};

export abstract class BaseBlock<TDefinition extends _AnyBlockDefinition> {
    public readonly config: ConfigValues<TDefinition["config"]>;
    public readonly definition: TDefinition;
    public readonly name: string;

    protected constructor(definition: TDefinition, options: BlockOptions<TDefinition> | undefined) {
        this.definition = definition;
        this.name = options?.name ?? new.target.name;
        this.config = resolveConfig(definition.config, options);
    }
}

export class InputBlock<TDefinition extends _AnyBlockDefinition<"input">> extends BaseBlock<TDefinition> {
    public readonly defaultInput: ValueOf<TDefinition["input"]> | undefined;
    public readonly output: OutputPort<TDefinition["output"]>;

    public constructor(definition: TDefinition, options?: InputBlockOptions<TDefinition>) {
        if (definition.kind !== "input") {
            throw new Error(`InputBlock requires an input block definition, received "${definition.kind}".`);
        }
        super(definition, options);
        this.defaultInput = options?.input;
        this.output = new OutputPort(this, definition.output);
    }
}

export class TransformBlock<TDefinition extends _AnyBlockDefinition<"transform">> extends BaseBlock<TDefinition> {
    public readonly input: InputPort<TDefinition["input"]>;
    public readonly output: OutputPort<TDefinition["output"]>;

    public constructor(definition: TDefinition, options?: BlockOptions<TDefinition>) {
        if (definition.kind !== "transform") {
            throw new Error(`TransformBlock requires a transform block definition, received "${definition.kind}".`);
        }
        super(definition, options);
        this.input = new InputPort(this, definition.input);
        this.output = new OutputPort(this, definition.output);
    }
}

export class OutputBlock<TDefinition extends _AnyBlockDefinition<"output">> extends BaseBlock<TDefinition> {
    public readonly input: InputPort<TDefinition["input"]>;

    public constructor(definition: TDefinition, options?: BlockOptions<TDefinition>) {
        if (definition.kind !== "output") {
            throw new Error(`OutputBlock requires an output block definition, received "${definition.kind}".`);
        }
        super(definition, options);
        this.input = new InputPort(this, definition.input);
    }
}

export class InputPort<TType extends ValueType<unknown>> {
    /** @internal */
    public _source: OutputPort<TType> | undefined;

    public constructor(
        /** @internal */
        public readonly _block: BaseBlock<_AnyBlockDefinition>,
        public readonly type: TType
    ) {}
}

export class OutputPort<TType extends ValueType<unknown>> {
    readonly #endpoints = new Set<InputPort<TType>>();

    public constructor(
        /** @internal */
        public readonly _block: BaseBlock<_AnyBlockDefinition>,
        public readonly type: TType
    ) {}

    public connectTo<TInputType extends ValueType<unknown>>(input: ValueOf<TType> extends ValueOf<TInputType> ? InputPort<TInputType> : never): void {
        if (!input.type.accepts(this.type)) {
            throw new Error(`Cannot connect value type "${this.type.id}" to "${input.type.id}".`);
        }
        if (input._source !== undefined) {
            throw new Error(`The input on block "${input._block.name}" is already connected.`);
        }
        if (reaches(input._block, this._block)) {
            throw new Error("The connection would create a cycle.");
        }

        input._source = this as unknown as OutputPort<TInputType>;
        this.#endpoints.add(input as unknown as InputPort<TType>);
    }

    /** @internal */
    public get _endpoints(): ReadonlySet<InputPort<TType>> {
        return this.#endpoints;
    }
}

function resolveConfig<TConfig extends ConfigDefinition>(config: TConfig, options: Readonly<Record<string, unknown>> | undefined): ConfigValues<TConfig> {
    const values: Record<string, unknown> = {};
    for (const [name, descriptor] of Object.entries(config)) {
        const value = options?.[name] ?? descriptor.defaultValue;
        if (!descriptor.is(value)) {
            throw new Error(`Invalid value for config "${name}".`);
        }
        values[name] = value;
    }
    return Object.freeze(values) as ConfigValues<TConfig>;
}

function reaches(start: BaseBlock<_AnyBlockDefinition>, target: BaseBlock<_AnyBlockDefinition>): boolean {
    const pending = [start];
    const visited = new Set<BaseBlock<_AnyBlockDefinition>>();

    while (pending.length > 0) {
        const block = pending.pop();
        if (block === undefined || visited.has(block)) {
            continue;
        }
        if (block === target) {
            return true;
        }

        visited.add(block);
        if (block instanceof InputBlock || block instanceof TransformBlock) {
            for (const endpoint of block.output._endpoints) {
                pending.push(endpoint._block);
            }
        }
    }
    return false;
}
