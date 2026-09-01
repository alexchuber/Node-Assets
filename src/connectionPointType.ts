declare const connectionPointData: unique symbol;

export interface ConnectionPointType<TData> {
    readonly id: string;
    readonly [connectionPointData]: TData;
    is(value: unknown): value is TData;
}

export type RuntimeData<TType extends ConnectionPointType<unknown>> = TType extends ConnectionPointType<infer TData> ? TData : never;

export function defineConnectionPointType<TData>(id: string, isData: (value: unknown) => value is TData): ConnectionPointType<TData> {
    return Object.freeze({ id, is: isData }) as ConnectionPointType<TData>;
}
