type MaybePromise<TValue> = TValue | Promise<TValue>;

export interface ResourceDependencies {
    readonly [name: string]: AnyResource;
}

export interface AnyResource {
    readonly name: string;
    readonly dependencies?: ResourceDependencies;
    create(dependencies: ResourceValues<ResourceDependencies>): MaybePromise<unknown>;
    dispose(value: unknown): MaybePromise<void>;
}

export type ResourceValue<TResource extends AnyResource> = Awaited<ReturnType<TResource["create"]>>;

export type ResourceValues<TResources extends ResourceDependencies> = {
    readonly [TName in keyof TResources]: ResourceValue<TResources[TName]>;
};

type ResourceDefinition<TValue, TDependencies extends ResourceDependencies> = {
    /** The name used to identify the resource in diagnostics. */
    readonly name: string;
    /** Creates the resource from its resolved dependencies. */
    create(dependencies: ResourceValues<TDependencies>): MaybePromise<TValue>;
    /** Releases the resource. */
    dispose(value: TValue): MaybePromise<void>;
};

/** Defines a lazily created value owned by a node asset execution. */
export type Resource<TValue, TDependencies extends ResourceDependencies = Record<never, never>> = ResourceDefinition<TValue, TDependencies> &
    (keyof TDependencies extends never
        ? {
              /** Resources that must be available before this resource is created. */
              readonly dependencies?: TDependencies;
          }
        : {
              /** Resources that must be available before this resource is created. */
              readonly dependencies: TDependencies;
          });
