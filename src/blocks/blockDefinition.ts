import type { ResourceRequirements, ResourceValues } from "../resources/resource";

declare const valueType: unique symbol;

export interface ValueType<TValue> {
    readonly id: string;
    readonly [valueType]: TValue;
    is(value: unknown): value is TValue;
}

export type ValueOf<TType extends ValueType<unknown>> = TType extends ValueType<infer TValue> ? TValue : never;

export function defineValueType<TValue>(id: string, isValue: (value: unknown) => value is TValue): ValueType<TValue> {
    return Object.freeze({ id, is: isValue }) as ValueType<TValue>;
}

declare const configType: unique symbol;

export interface ConfigValue<TValue> {
    readonly defaultValue: TValue;
    readonly [configType]: TValue;
    is(value: unknown): value is TValue;
}

export type ConfigDefinition = Readonly<Record<string, ConfigValue<unknown>>>;

export type ConfigValues<TConfig extends ConfigDefinition> = {
    readonly [TName in keyof TConfig]: TConfig[TName] extends ConfigValue<infer TValue> ? TValue : never;
};

export function value<TValue>(type: ValueType<TValue>, defaultValue: TValue): ConfigValue<TValue> {
    return Object.freeze({ defaultValue, is: type.is }) as ConfigValue<TValue>;
}

export function enumValue<const TValues extends readonly [string, ...string[]]>(values: TValues, defaultValue: TValues[number] = values[0]): ConfigValue<TValues[number]> {
    return Object.freeze({
        defaultValue,
        is: (value: unknown): value is TValues[number] => typeof value === "string" && values.includes(value),
    }) as ConfigValue<TValues[number]>;
}

/** @internal */
export interface _AnyBlockDefinition<TKind extends "input" | "transform" | "output" = "input" | "transform" | "output"> {
    readonly kind: TKind;
    readonly type: string;
    readonly version: 1;
    readonly input: ValueType<unknown>;
    readonly output: ValueType<unknown>;
    readonly config: ConfigDefinition;
    readonly resources: ResourceRequirements;
    readonly run?: unknown;
    readonly runAsync?: unknown;
    readonly resolveBlock?: unknown;
}

type SwitchTarget<TInput extends ValueType<unknown>, TOutput extends ValueType<unknown>> =
    | (_AnyBlockDefinition & { readonly input: TInput; readonly output: TOutput })
    | {
          readonly definition: _AnyBlockDefinition & { readonly input: TInput; readonly output: TOutput };
          readonly config: Readonly<Record<string, unknown>>;
      };

type Runner<TInput extends ValueType<unknown>, TOutput extends ValueType<unknown>, TConfig extends ConfigDefinition, TResources extends ResourceRequirements> =
    | {
          readonly run: (input: ValueOf<TInput>, config: ConfigValues<TConfig>, resources: ResourceValues<TResources>) => ValueOf<TOutput>;
          readonly runAsync?: never;
      }
    | {
          readonly run?: never;
          readonly runAsync: (input: ValueOf<TInput>, config: ConfigValues<TConfig>, resources: ResourceValues<TResources>) => Promise<ValueOf<TOutput>>;
      };

type Definition<
    TKind extends string,
    TInput extends ValueType<unknown>,
    TOutput extends ValueType<unknown>,
    TConfig extends ConfigDefinition,
    TResources extends ResourceRequirements,
> = {
    readonly kind: TKind;
    readonly type: string;
    readonly version: 1;
    readonly input: TInput;
    readonly output: TOutput;
    readonly config: TConfig;
    readonly resources: TResources;
} & Runner<TInput, TOutput, TConfig, TResources>;

type SwitchDefinition<TKind extends string, TInput extends ValueType<unknown>, TOutput extends ValueType<unknown>, TConfig extends ConfigDefinition> = {
    readonly kind: TKind;
    readonly type: string;
    readonly version: 1;
    readonly input: TInput;
    readonly output: TOutput;
    readonly config: TConfig;
    readonly resources: Record<never, never>;
    readonly resolveBlock: (input: ValueOf<TInput>, config: ConfigValues<TConfig>) => SwitchTarget<TInput, TOutput>;
    readonly run?: never;
    readonly runAsync?: never;
};

export type InputBlockDefinition<
    TInput extends ValueType<unknown> = ValueType<unknown>,
    TOutput extends ValueType<unknown> = ValueType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
    TResources extends ResourceRequirements = ResourceRequirements,
> = Definition<"input", TInput, TOutput, TConfig, TResources>;

export type TransformBlockDefinition<
    TInput extends ValueType<unknown> = ValueType<unknown>,
    TOutput extends ValueType<unknown> = ValueType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
    TResources extends ResourceRequirements = ResourceRequirements,
> = Definition<"transform", TInput, TOutput, TConfig, TResources>;

export type OutputBlockDefinition<
    TInput extends ValueType<unknown> = ValueType<unknown>,
    TOutput extends ValueType<unknown> = ValueType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
    TResources extends ResourceRequirements = ResourceRequirements,
> = Definition<"output", TInput, TOutput, TConfig, TResources>;

export type BlockDefinition = InputBlockDefinition | TransformBlockDefinition | OutputBlockDefinition;

export type SwitchInputBlockDefinition<
    TInput extends ValueType<unknown> = ValueType<unknown>,
    TOutput extends ValueType<unknown> = ValueType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
> = SwitchDefinition<"input", TInput, TOutput, TConfig>;

export type SwitchTransformBlockDefinition<
    TInput extends ValueType<unknown> = ValueType<unknown>,
    TOutput extends ValueType<unknown> = ValueType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
> = SwitchDefinition<"transform", TInput, TOutput, TConfig>;

export type SwitchOutputBlockDefinition<
    TInput extends ValueType<unknown> = ValueType<unknown>,
    TOutput extends ValueType<unknown> = ValueType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
> = SwitchDefinition<"output", TInput, TOutput, TConfig>;

type DefinitionOptions<TInput extends ValueType<unknown>, TOutput extends ValueType<unknown>, TConfig extends ConfigDefinition, TResources extends ResourceRequirements> = {
    readonly type: string;
    readonly input: TInput;
    readonly output: TOutput;
    readonly config?: TConfig;
    readonly resources?: TResources;
} & Runner<TInput, TOutput, TConfig, TResources>;

interface SwitchDefinitionOptions<TInput extends ValueType<unknown>, TOutput extends ValueType<unknown>, TConfig extends ConfigDefinition> {
    readonly type: string;
    readonly input: TInput;
    readonly output: TOutput;
    readonly config?: TConfig;
    readonly resolveBlock: (input: ValueOf<TInput>, config: ConfigValues<TConfig>) => SwitchTarget<TInput, TOutput>;
}

export function defineInputBlock<
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
    const TResources extends ResourceRequirements = Record<never, never>,
>(definition: DefinitionOptions<TInput, TOutput, TConfig, TResources>): InputBlockDefinition<TInput, TOutput, TConfig, TResources> {
    return freezeDefinition("input", definition);
}

export function defineTransformBlock<
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
    const TResources extends ResourceRequirements = Record<never, never>,
>(definition: DefinitionOptions<TInput, TOutput, TConfig, TResources>): TransformBlockDefinition<TInput, TOutput, TConfig, TResources> {
    return freezeDefinition("transform", definition);
}

export function defineOutputBlock<
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
    const TResources extends ResourceRequirements = Record<never, never>,
>(definition: DefinitionOptions<TInput, TOutput, TConfig, TResources>): OutputBlockDefinition<TInput, TOutput, TConfig, TResources> {
    return freezeDefinition("output", definition);
}

export function defineSwitchInputBlock<
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
>(definition: SwitchDefinitionOptions<TInput, TOutput, TConfig>): SwitchInputBlockDefinition<TInput, TOutput, TConfig> {
    return freezeSwitchDefinition("input", definition);
}

export function defineSwitchTransformBlock<
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
>(definition: SwitchDefinitionOptions<TInput, TOutput, TConfig>): SwitchTransformBlockDefinition<TInput, TOutput, TConfig> {
    return freezeSwitchDefinition("transform", definition);
}

export function defineSwitchOutputBlock<
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
>(definition: SwitchDefinitionOptions<TInput, TOutput, TConfig>): SwitchOutputBlockDefinition<TInput, TOutput, TConfig> {
    return freezeSwitchDefinition("output", definition);
}

function freezeDefinition<
    const TKind extends "input" | "transform" | "output",
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition,
    const TResources extends ResourceRequirements,
>(kind: TKind, definition: DefinitionOptions<TInput, TOutput, TConfig, TResources>): Definition<TKind, TInput, TOutput, TConfig, TResources> {
    const config = Object.freeze({ ...(definition.config ?? {}) }) as TConfig;
    const resources = Object.freeze({ ...(definition.resources ?? {}) }) as TResources;
    return Object.freeze({ ...definition, config, resources, kind, version: 1 });
}

function freezeSwitchDefinition<
    const TKind extends "input" | "transform" | "output",
    const TInput extends ValueType<unknown>,
    const TOutput extends ValueType<unknown>,
    const TConfig extends ConfigDefinition,
>(kind: TKind, definition: SwitchDefinitionOptions<TInput, TOutput, TConfig>): SwitchDefinition<TKind, TInput, TOutput, TConfig> {
    const config = Object.freeze({ ...(definition.config ?? {}) }) as TConfig;
    return Object.freeze({ ...definition, config, resources: Object.freeze({}), kind, version: 1 });
}
