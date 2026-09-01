declare const resourceType: unique symbol;

/** @internal */
export type _ResourceResolver = <TValue>(definition: ResourceDefinition<TValue>) => Promise<TValue>;

export interface ResourceDefinition<TValue> {
    readonly id: string;
    readonly [resourceType]: TValue;
    createAsync(resolveResource: _ResourceResolver): Promise<TValue>;
    disposeAsync?(value: TValue): Promise<void> | void;
}

export interface ResourceRequirement<TValue, TResource = TValue> {
    readonly definition: ResourceDefinition<TResource>;
    isEnabled(config: Readonly<Record<string, unknown>>): boolean;
    readonly [resourceType]: TValue;
}

export type ResourceRequirements = Readonly<Record<string, ResourceRequirement<unknown, unknown>>>;

export type ResourceValues<TResources extends ResourceRequirements> = {
    readonly [TName in keyof TResources]: TResources[TName] extends ResourceRequirement<infer TValue> ? TValue : never;
};

export function defineResource<TValue>(definition: Omit<ResourceDefinition<TValue>, typeof resourceType>): ResourceDefinition<TValue> {
    return Object.freeze(definition) as ResourceDefinition<TValue>;
}

export function resource<TValue>(definition: ResourceDefinition<TValue>): ResourceRequirement<TValue> {
    return Object.freeze({ definition, isEnabled: () => true }) as unknown as ResourceRequirement<TValue>;
}

export function conditionalResource<TValue>(
    definition: ResourceDefinition<TValue>,
    isEnabled: (config: Readonly<Record<string, unknown>>) => boolean
): ResourceRequirement<TValue | undefined, TValue> {
    return Object.freeze({ definition, isEnabled }) as ResourceRequirement<TValue | undefined, TValue>;
}

/** @internal */
export class _ResourceContainer {
    readonly #resources = new Map<ResourceDefinition<unknown>, Promise<unknown>>();
    readonly #resolved: { readonly definition: ResourceDefinition<unknown>; readonly value: unknown }[] = [];
    #disposed = false;

    public acquireAsync<TValue>(definition: ResourceDefinition<TValue>): Promise<TValue> {
        if (this.#disposed) {
            return Promise.reject(new Error("The resource container has been disposed."));
        }

        const existing = this.#resources.get(definition);
        if (existing !== undefined) {
            return existing as Promise<TValue>;
        }

        const pending = Promise.resolve().then(() => definition.createAsync((dependency) => this.acquireAsync(dependency)));
        this.#resources.set(definition, pending);
        void pending.then(
            (value) => this.#resolved.push({ definition, value }),
            () => this.#resources.delete(definition)
        );
        return pending;
    }

    public async disposeAsync(): Promise<void> {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;

        await Promise.allSettled(this.#resources.values());
        for (let index = this.#resolved.length - 1; index >= 0; index -= 1) {
            const resource = this.#resolved[index];
            if (resource !== undefined) {
                await resource.definition.disposeAsync?.(resource.value);
            }
        }
        this.#resources.clear();
        this.#resolved.length = 0;
    }
}
