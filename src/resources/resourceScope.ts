import type { AnyResource, ResourceDependencies, ResourceValues } from "./resource";

interface AcquiredResource {
    readonly resource: AnyResource;
    readonly value: unknown;
}

export class ResourceScope {
    readonly #instances = new Map<AnyResource, Promise<unknown>>();
    readonly #acquired: AcquiredResource[] = [];
    #isDisposed = false;

    public async resolveAllAsync<TResources extends ResourceDependencies>(resources: TResources): Promise<ResourceValues<TResources>> {
        const values: Record<string, unknown> = {};
        for (const [name, resource] of Object.entries(resources)) {
            values[name] = await this.#resolveAsync(resource, new Set());
        }
        return Object.freeze(values) as ResourceValues<TResources>;
    }

    public async disposeAsync(): Promise<void> {
        if (this.#isDisposed) {
            return;
        }
        this.#isDisposed = true;

        const errors: unknown[] = [];
        for (let index = this.#acquired.length - 1; index >= 0; index--) {
            const acquired = this.#acquired[index];
            if (acquired === undefined) {
                continue;
            }
            try {
                await acquired.resource.dispose(acquired.value);
            } catch (error) {
                errors.push(error);
            }
        }
        this.#instances.clear();
        this.#acquired.length = 0;

        if (errors.length > 0) {
            throw new AggregateError(errors, "Failed to dispose one or more resources.");
        }
    }

    async #resolveAsync(resource: AnyResource, resolving: ReadonlySet<AnyResource>): Promise<unknown> {
        if (this.#isDisposed) {
            throw new Error("ResourceScope is disposed.");
        }
        if (resolving.has(resource)) {
            throw new Error(`Resource dependency cycle detected at "${resource.name}".`);
        }

        const existing = this.#instances.get(resource);
        if (existing !== undefined) {
            return existing;
        }

        const path = new Set(resolving);
        path.add(resource);
        const acquisition = (async () => {
            const dependencies = await this.resolveAllWithPathAsync(resource.dependencies ?? {}, path);
            const value = await resource.create(dependencies);
            this.#acquired.push({ resource, value });
            return value;
        })();
        this.#instances.set(resource, acquisition);

        try {
            return await acquisition;
        } catch (error) {
            if (this.#instances.get(resource) === acquisition) {
                this.#instances.delete(resource);
            }
            throw error;
        }
    }

    private async resolveAllWithPathAsync(resources: ResourceDependencies, resolving: ReadonlySet<AnyResource>): Promise<ResourceValues<ResourceDependencies>> {
        const values: Record<string, unknown> = {};
        for (const [name, resource] of Object.entries(resources)) {
            values[name] = await this.#resolveAsync(resource, resolving);
        }
        return Object.freeze(values) as ResourceValues<ResourceDependencies>;
    }
}
