import type { ConnectionPointType, ConnectionPointValue } from "../connectionPoints/connectionPoint";
import type { ResourceDependencies, ResourceValues } from "../resources/resource";

declare const configType: unique symbol;

/** Validation metadata for a block configuration value. */
export type ConfigDescriptor =
    | { readonly kind: "boolean" }
    | { readonly kind: "integer" | "number"; readonly min?: number; readonly max?: number }
    | { readonly kind: "enum"; readonly values: readonly string[] }
    | { readonly kind: "custom" };

export interface ConfigValue<TValue> {
    readonly defaultValue: TValue;
    readonly descriptor: ConfigDescriptor;
    readonly [configType]: TValue;
    is(value: unknown): value is TValue;
}

export type ConfigDefinition = Readonly<Record<string, ConfigValue<unknown>>>;
export type AuxiliaryInputDefinition = Readonly<Record<string, ConnectionPointType<unknown>>>;

export type ConfigValues<TConfig extends ConfigDefinition> = {
    readonly [TName in keyof TConfig]: TConfig[TName] extends ConfigValue<infer TValue> ? TValue : never;
};

export type AuxiliaryInputValues<TInputs extends AuxiliaryInputDefinition> = {
    readonly [TName in keyof TInputs]: ConnectionPointValue<TInputs[TName]> | undefined;
};

export function value<TValue>(type: ConnectionPointType<TValue>, defaultValue: TValue): ConfigValue<TValue> {
    return Object.freeze({ defaultValue, descriptor: Object.freeze({ kind: "custom" }), is: type.is }) as ConfigValue<TValue>;
}

/** Describes a boolean configuration value. */
export function booleanValue(defaultValue: boolean): ConfigValue<boolean> {
    return Object.freeze({
        defaultValue,
        descriptor: Object.freeze({ kind: "boolean" }),
        is: (value: unknown): value is boolean => typeof value === "boolean",
    }) as ConfigValue<boolean>;
}

/** Inclusive bounds for numeric configuration values. */
export interface ConfigRange {
    readonly min?: number;
    readonly max?: number;
}

/** Describes a finite integer configuration value with optional inclusive bounds. */
export function integerValue(defaultValue: number, range: ConfigRange = {}): ConfigValue<number> {
    return numericValue("integer", defaultValue, range);
}

/** Describes a finite numeric configuration value with optional inclusive bounds. */
export function numberValue(defaultValue: number, range: ConfigRange = {}): ConfigValue<number> {
    return numericValue("number", defaultValue, range);
}

function numericValue(kind: "integer" | "number", defaultValue: number, range: ConfigRange): ConfigValue<number> {
    const descriptor = Object.freeze({ kind, ...range });
    return Object.freeze({
        defaultValue,
        descriptor,
        is: (value: unknown): value is number =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            (kind !== "integer" || Number.isInteger(value)) &&
            (descriptor.min === undefined || value >= descriptor.min) &&
            (descriptor.max === undefined || value <= descriptor.max),
    }) as ConfigValue<number>;
}

export function enumValue<const TValues extends readonly [string, ...string[]]>(values: TValues, defaultValue: TValues[number] = values[0]): ConfigValue<TValues[number]> {
    const choices = Object.freeze([...values]);
    return Object.freeze({
        defaultValue,
        descriptor: Object.freeze({ kind: "enum", values: choices }),
        is: (value: unknown): value is TValues[number] => typeof value === "string" && choices.includes(value),
    }) as ConfigValue<TValues[number]>;
}

export interface _AnyBlockDefinition {
    readonly type: string;
    readonly version: 1;
    readonly input: ConnectionPointType<unknown> | undefined;
    readonly auxiliaryInputs: AuxiliaryInputDefinition;
    readonly output: ConnectionPointType<unknown>;
    readonly config: ConfigDefinition;
    readonly resources: ResourceDependencies;
    readonly run?: unknown;
    readonly runAsync?: unknown;
}

export type _InputBlockDefinition = _AnyBlockDefinition & {
    readonly input: ConnectionPointType<unknown>;
};

type Runner<
    TInput extends ConnectionPointType<unknown>,
    TOutput extends ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition,
    TResources extends ResourceDependencies,
    TAuxiliaryInputs extends AuxiliaryInputDefinition,
> =
    | {
          readonly run: (
              input: ConnectionPointValue<TInput>,
              config: ConfigValues<TConfig>,
              resources: ResourceValues<TResources>,
              auxiliaryInputs: AuxiliaryInputValues<TAuxiliaryInputs>
          ) => ConnectionPointValue<TOutput>;
          readonly runAsync?: never;
      }
    | {
          readonly run?: never;
          readonly runAsync: (
              input: ConnectionPointValue<TInput>,
              config: ConfigValues<TConfig>,
              resources: ResourceValues<TResources>,
              auxiliaryInputs: AuxiliaryInputValues<TAuxiliaryInputs>
          ) => Promise<ConnectionPointValue<TOutput>>;
      };

export type BlockDefinition<
    TInput extends ConnectionPointType<unknown> = ConnectionPointType<unknown>,
    TOutput extends ConnectionPointType<unknown> = ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
    TResources extends ResourceDependencies = ResourceDependencies,
    TAuxiliaryInputs extends AuxiliaryInputDefinition = AuxiliaryInputDefinition,
> = {
    readonly type: string;
    readonly version: 1;
    readonly input: TInput;
    readonly auxiliaryInputs: TAuxiliaryInputs;
    readonly output: TOutput;
    readonly config: TConfig;
    readonly resources: TResources;
} & Runner<TInput, TOutput, TConfig, TResources, TAuxiliaryInputs>;

type SourceRunner<
    TOutput extends ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition,
    TResources extends ResourceDependencies,
    TAuxiliaryInputs extends AuxiliaryInputDefinition,
> =
    | {
          readonly run: (
              config: ConfigValues<TConfig>,
              resources: ResourceValues<TResources>,
              auxiliaryInputs: AuxiliaryInputValues<TAuxiliaryInputs>
          ) => ConnectionPointValue<TOutput>;
          readonly runAsync?: never;
      }
    | {
          readonly run?: never;
          readonly runAsync: (
              config: ConfigValues<TConfig>,
              resources: ResourceValues<TResources>,
              auxiliaryInputs: AuxiliaryInputValues<TAuxiliaryInputs>
          ) => Promise<ConnectionPointValue<TOutput>>;
      };

export type SourceBlockDefinition<
    TOutput extends ConnectionPointType<unknown> = ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
    TResources extends ResourceDependencies = ResourceDependencies,
    TAuxiliaryInputs extends AuxiliaryInputDefinition = AuxiliaryInputDefinition,
> = {
    readonly type: string;
    readonly version: 1;
    readonly input: undefined;
    readonly auxiliaryInputs: TAuxiliaryInputs;
    readonly output: TOutput;
    readonly config: TConfig;
    readonly resources: TResources;
} & SourceRunner<TOutput, TConfig, TResources, TAuxiliaryInputs>;

type DefinitionOptions<
    TInput extends ConnectionPointType<unknown>,
    TOutput extends ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition,
    TResources extends ResourceDependencies,
    TAuxiliaryInputs extends AuxiliaryInputDefinition,
> = {
    readonly type: string;
    readonly input: TInput;
    readonly auxiliaryInputs?: TAuxiliaryInputs;
    readonly output: TOutput;
    readonly config?: TConfig;
    readonly resources?: TResources;
} & Runner<TInput, TOutput, TConfig, TResources, TAuxiliaryInputs>;

type SourceDefinitionOptions<
    TOutput extends ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition,
    TResources extends ResourceDependencies,
    TAuxiliaryInputs extends AuxiliaryInputDefinition,
> = {
    readonly type: string;
    readonly output: TOutput;
    readonly auxiliaryInputs?: TAuxiliaryInputs;
    readonly config?: TConfig;
    readonly resources?: TResources;
} & SourceRunner<TOutput, TConfig, TResources, TAuxiliaryInputs>;

export function defineBlock<
    const TInput extends ConnectionPointType<unknown>,
    const TOutput extends ConnectionPointType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
    const TResources extends ResourceDependencies = Record<never, never>,
    const TAuxiliaryInputs extends AuxiliaryInputDefinition = Record<never, never>,
>(definition: DefinitionOptions<TInput, TOutput, TConfig, TResources, TAuxiliaryInputs>): BlockDefinition<TInput, TOutput, TConfig, TResources, TAuxiliaryInputs> {
    return freezeDefinition(definition);
}

export function defineSourceBlock<
    const TOutput extends ConnectionPointType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
    const TResources extends ResourceDependencies = Record<never, never>,
    const TAuxiliaryInputs extends AuxiliaryInputDefinition = Record<never, never>,
>(definition: SourceDefinitionOptions<TOutput, TConfig, TResources, TAuxiliaryInputs>): SourceBlockDefinition<TOutput, TConfig, TResources, TAuxiliaryInputs> {
    const config = Object.freeze({ ...(definition.config ?? {}) }) as TConfig;
    const resources = Object.freeze({ ...(definition.resources ?? {}) }) as TResources;
    const auxiliaryInputs = Object.freeze({ ...(definition.auxiliaryInputs ?? {}) }) as TAuxiliaryInputs;
    return Object.freeze({ ...definition, input: undefined, auxiliaryInputs, config, resources, version: 1 });
}

function freezeDefinition<
    const TInput extends ConnectionPointType<unknown>,
    const TOutput extends ConnectionPointType<unknown>,
    const TConfig extends ConfigDefinition,
    const TResources extends ResourceDependencies,
    const TAuxiliaryInputs extends AuxiliaryInputDefinition,
>(definition: DefinitionOptions<TInput, TOutput, TConfig, TResources, TAuxiliaryInputs>): BlockDefinition<TInput, TOutput, TConfig, TResources, TAuxiliaryInputs> {
    const config = Object.freeze({ ...(definition.config ?? {}) }) as TConfig;
    const resources = Object.freeze({ ...(definition.resources ?? {}) }) as TResources;
    const auxiliaryInputs = Object.freeze({ ...(definition.auxiliaryInputs ?? {}) }) as TAuxiliaryInputs;
    return Object.freeze({ ...definition, auxiliaryInputs, config, resources, version: 1 });
}
