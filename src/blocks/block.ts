import type { ConnectionPointType, RuntimeData } from "../connectionPointType";
import type { _AnyBlockDefinition, ConfigDefinition, ConfigValues } from "./blockDefinition";

export type BlockOptions<TDefinition extends _AnyBlockDefinition> = Partial<ConfigValues<TDefinition["config"]>> & {
    readonly input?: RuntimeData<TDefinition["input"]>;
    readonly name?: string;
};

export class Block<TDefinition extends _AnyBlockDefinition> {
    public readonly config: ConfigValues<TDefinition["config"]>;
    public readonly defaultInput: RuntimeData<TDefinition["input"]> | undefined;
    public readonly definition: TDefinition;
    public readonly input: InputPort<TDefinition["input"]>;
    public readonly name: string;
    public readonly output: OutputPort<TDefinition["output"]>;

    public constructor(definition: TDefinition, options?: BlockOptions<TDefinition>) {
        this.definition = definition;
        this.name = options?.name ?? new.target.name;
        this.config = resolveConfig(definition.config, options);
        this.defaultInput = options?.input;
        this.input = new InputPort(this, definition.input);
        this.output = new OutputPort(this, definition.output);
    }
}

export class InputPort<TType extends ConnectionPointType<unknown>> {
    /** @internal */
    public _source: OutputPort<TType> | undefined;

    public constructor(
        /** @internal */
        public readonly _block: Block<_AnyBlockDefinition>,
        public readonly type: TType
    ) {}
}

export class OutputPort<TType extends ConnectionPointType<unknown>> {
    readonly #endpoints = new Set<InputPort<TType>>();

    public constructor(
        /** @internal */
        public readonly _block: Block<_AnyBlockDefinition>,
        public readonly type: TType
    ) {}

    public connectTo(input: InputPort<NoInfer<TType>>): void {
        if (this.type !== input.type) {
            throw new Error(`Cannot connect connection point type "${this.type.id}" to "${input.type.id}".`);
        }
        if (input._source !== undefined) {
            throw new Error(`The input on block "${input._block.name}" is already connected.`);
        }
        if (reaches(input._block, this._block)) {
            throw new Error("The connection would create a cycle.");
        }

        input._source = this;
        this.#endpoints.add(input);
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

function reaches(start: Block<_AnyBlockDefinition>, target: Block<_AnyBlockDefinition>): boolean {
    const pending = [start];
    const visited = new Set<Block<_AnyBlockDefinition>>();

    while (pending.length > 0) {
        const block = pending.pop();
        if (block === undefined || visited.has(block)) {
            continue;
        }
        if (block === target) {
            return true;
        }

        visited.add(block);
        for (const endpoint of block.output._endpoints) {
            pending.push(endpoint._block);
        }
    }
    return false;
}
