import type { ConnectionPointType, ConnectionPointValue } from "../connectionPointType";

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

export function value<TValue>(type: ConnectionPointType<TValue>, defaultValue: TValue): ConfigValue<TValue> {
    return Object.freeze({ defaultValue, is: type.is }) as ConfigValue<TValue>;
}

export function enumValue<const TValues extends readonly [string, ...string[]]>(values: TValues, defaultValue: TValues[number] = values[0]): ConfigValue<TValues[number]> {
    return Object.freeze({
        defaultValue,
        is: (value: unknown): value is TValues[number] => typeof value === "string" && values.includes(value),
    }) as ConfigValue<TValues[number]>;
}

/** @internal */
export interface _AnyBlockDefinition {
    readonly type: string;
    readonly version: 1;
    readonly input: ConnectionPointType<unknown>;
    readonly output: ConnectionPointType<unknown>;
    readonly config: ConfigDefinition;
    readonly run?: unknown;
    readonly runAsync?: unknown;
}

type Runner<TInput extends ConnectionPointType<unknown>, TOutput extends ConnectionPointType<unknown>, TConfig extends ConfigDefinition> =
    | {
          readonly run: (input: ConnectionPointValue<TInput>, config: ConfigValues<TConfig>) => ConnectionPointValue<TOutput>;
          readonly runAsync?: never;
      }
    | {
          readonly run?: never;
          readonly runAsync: (input: ConnectionPointValue<TInput>, config: ConfigValues<TConfig>) => Promise<ConnectionPointValue<TOutput>>;
      };

export type BlockDefinition<
    TInput extends ConnectionPointType<unknown> = ConnectionPointType<unknown>,
    TOutput extends ConnectionPointType<unknown> = ConnectionPointType<unknown>,
    TConfig extends ConfigDefinition = ConfigDefinition,
> = {
    readonly type: string;
    readonly version: 1;
    readonly input: TInput;
    readonly output: TOutput;
    readonly config: TConfig;
} & Runner<TInput, TOutput, TConfig>;

type DefinitionOptions<TInput extends ConnectionPointType<unknown>, TOutput extends ConnectionPointType<unknown>, TConfig extends ConfigDefinition> = {
    readonly type: string;
    readonly input: TInput;
    readonly output: TOutput;
    readonly config?: TConfig;
} & Runner<TInput, TOutput, TConfig>;

export function defineBlock<
    const TInput extends ConnectionPointType<unknown>,
    const TOutput extends ConnectionPointType<unknown>,
    const TConfig extends ConfigDefinition = Record<never, never>,
>(definition: DefinitionOptions<TInput, TOutput, TConfig>): BlockDefinition<TInput, TOutput, TConfig> {
    return freezeDefinition(definition);
}

function freezeDefinition<const TInput extends ConnectionPointType<unknown>, const TOutput extends ConnectionPointType<unknown>, const TConfig extends ConfigDefinition>(
    definition: DefinitionOptions<TInput, TOutput, TConfig>
): BlockDefinition<TInput, TOutput, TConfig> {
    const config = Object.freeze({ ...(definition.config ?? {}) }) as TConfig;
    return Object.freeze({ ...definition, config, version: 1 });
}
