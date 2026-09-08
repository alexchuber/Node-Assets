import type { ConnectionPointType, ConnectionPointValue } from "./connectionPointType";
import type { _AnyBlockDefinition, AuxiliaryInputDefinition, ConfigDefinition, ConfigValues } from "./blockDefinition";

/** @internal */
export interface _BlockRuntime {
    readonly name: string;
    readonly input: _InputPortRuntime | undefined;
    readonly auxiliaryInputs: Readonly<Record<string, _InputPortRuntime>>;
    readonly output: _OutputPortRuntime;
    readonly _config: Readonly<Record<string, unknown>>;
    readonly _definition: _AnyBlockDefinition;
}

interface _InputPortRuntime {
    readonly _block: _BlockRuntime;
    readonly type: ConnectionPointType<unknown>;
    readonly defaultValue: unknown;
    _source: _OutputPortRuntime | undefined;
}

interface _OutputPortRuntime {
    readonly _block: _BlockRuntime;
    readonly type: ConnectionPointType<unknown>;
    readonly _endpoints: ReadonlySet<_InputPortRuntime>;
}

/** Options shared by all block instances. */
export type BlockOptions<TDefinition extends _AnyBlockDefinition> = Partial<ConfigValues<TDefinition["config"]>> & {
    /** The value to use when an execution context does not supply one. */
    readonly input?: TDefinition["input"] extends ConnectionPointType<unknown> ? ConnectionPointValue<TDefinition["input"]> : never;
    /** The name used to identify the block. */
    readonly name?: string;
};

/** A typed processing step in a node asset graph. */
export class Block<TDefinition extends _AnyBlockDefinition> {
    public readonly name: string;
    public readonly input: BlockInputPort<TDefinition>;
    public readonly auxiliaryInputs: AuxiliaryInputPorts<TDefinition["auxiliaryInputs"]>;
    public readonly output: OutputPort<TDefinition["output"]>;

    /** @internal */
    public readonly _config: ConfigValues<TDefinition["config"]>;
    public readonly _definition: TDefinition;

    public constructor(definition: TDefinition, options?: BlockOptions<TDefinition>) {
        this._definition = definition;
        this.name = options?.name ?? new.target.name;
        this._config = resolveConfig(definition.config, options);
        this.input = (definition.input === undefined ? undefined : new InputPort(this, definition.input, options?.input)) as BlockInputPort<TDefinition>;
        this.auxiliaryInputs = createAuxiliaryInputPorts(this, definition.auxiliaryInputs);
        this.output = new OutputPort(this, definition.output);
    }
}

type BlockInputPort<TDefinition extends _AnyBlockDefinition> = [TDefinition["input"]] extends [undefined]
    ? undefined
    : undefined extends TDefinition["input"]
      ? InputPort<Extract<TDefinition["input"], ConnectionPointType<unknown>>> | undefined
      : InputPort<Extract<TDefinition["input"], ConnectionPointType<unknown>>>;

export type AuxiliaryInputPorts<TInputs extends AuxiliaryInputDefinition> = {
    readonly [TName in keyof TInputs]: InputPort<TInputs[TName]>;
};

/** A typed block input that accepts an initial, contextual, or connected value. */
export class InputPort<TType extends ConnectionPointType<unknown>> {
    /** @internal */
    public _source: OutputPort<TType> | undefined;

    public constructor(
        /** @internal */
        public readonly _block: _BlockRuntime,
        public readonly type: TType,
        public readonly defaultValue: ConnectionPointValue<TType> | undefined
    ) {}

    /** Connects this input to an output with the same type descriptor. */
    public connectTo(output: OutputPort<NoInfer<TType>>): void {
        output.connectTo(this);
    }

    /** Disconnects this input from an output. */
    public disconnectFrom(output: OutputPort<NoInfer<TType>>): void {
        output.disconnectFrom(this);
    }
}

/** A typed block output that can connect to compatible input ports. */
export class OutputPort<TType extends ConnectionPointType<unknown>> {
    readonly #endpoints = new Set<InputPort<TType>>();

    public constructor(
        /** @internal */
        public readonly _block: _BlockRuntime,
        public readonly type: TType
    ) {}

    /** Connects this output to an unconnected input with the same type descriptor. */
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

    /** Disconnects this output from an input. */
    public disconnectFrom(input: InputPort<NoInfer<TType>>): void {
        if (!this.#endpoints.delete(input)) {
            return;
        }
        if (input._source === this) {
            input._source = undefined;
        }
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

function createAuxiliaryInputPorts<TInputs extends AuxiliaryInputDefinition>(block: _BlockRuntime, inputs: TInputs): AuxiliaryInputPorts<TInputs> {
    const ports: Partial<AuxiliaryInputPorts<TInputs>> = {};
    for (const [name, type] of Object.entries(inputs)) {
        ports[name as keyof TInputs] = new InputPort(block, type, undefined) as AuxiliaryInputPorts<TInputs>[keyof TInputs];
    }
    return Object.freeze(ports) as AuxiliaryInputPorts<TInputs>;
}

function reaches(start: _BlockRuntime, target: _BlockRuntime): boolean {
    const pending = [start];
    const visited = new Set<_BlockRuntime>();

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
