import type { OutputBlock } from "./blocks/block";
import type { _AnyBlockDefinition } from "./blocks/blockDefinition";
import type { NodeAsset, NodeAssetContext, NodeAssetResult } from "./nodeAsset";
import { _ResourceContainer } from "./resources/resource";

type AnyOutputBlock = OutputBlock<_AnyBlockDefinition<"output">>;

export class NodeAssetCoordinator {
    readonly #activeExecutions = new Set<Promise<unknown>>();
    readonly #resources = new _ResourceContainer();
    #disposed = false;

    public prepareAsync<TOutput extends AnyOutputBlock>(asset: NodeAsset<TOutput>): Promise<void> {
        this.#assertActive();
        return asset._prepareAsync((definition) => this.#resources.acquireAsync(definition));
    }

    public executeAsync<TOutput extends AnyOutputBlock>(asset: NodeAsset<TOutput>, context?: NodeAssetContext<NodeAsset<TOutput>>): Promise<NodeAssetResult<TOutput>>;
    public executeAsync<TOutput extends AnyOutputBlock>(
        asset: NodeAsset<TOutput>,
        contexts: readonly NodeAssetContext<NodeAsset<TOutput>>[]
    ): Promise<readonly NodeAssetResult<TOutput>[]>;
    public executeAsync<TOutput extends AnyOutputBlock>(
        asset: NodeAsset<TOutput>,
        contextOrContexts?: NodeAssetContext<NodeAsset<TOutput>> | readonly NodeAssetContext<NodeAsset<TOutput>>[]
    ): Promise<NodeAssetResult<TOutput> | readonly NodeAssetResult<TOutput>[]> {
        this.#assertActive();
        const execution = this.#executeAsync(asset, contextOrContexts);
        this.#activeExecutions.add(execution);
        void execution.then(
            () => this.#activeExecutions.delete(execution),
            () => this.#activeExecutions.delete(execution)
        );
        return execution;
    }

    public async disposeAsync(): Promise<void> {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        await Promise.allSettled(this.#activeExecutions);
        await this.#resources.disposeAsync();
    }

    async #executeAsync<TOutput extends AnyOutputBlock>(
        asset: NodeAsset<TOutput>,
        contextOrContexts?: NodeAssetContext<NodeAsset<TOutput>> | readonly NodeAssetContext<NodeAsset<TOutput>>[]
    ): Promise<NodeAssetResult<TOutput> | readonly NodeAssetResult<TOutput>[]> {
        await asset._prepareAsync((definition) => this.#resources.acquireAsync(definition));
        if (Array.isArray(contextOrContexts)) {
            return Promise.all(contextOrContexts.map((context) => asset._executeAsync(context, (definition) => this.#resources.acquireAsync(definition))));
        }
        return asset._executeAsync(contextOrContexts as NodeAssetContext<NodeAsset<TOutput>> | undefined, (definition) => this.#resources.acquireAsync(definition));
    }

    #assertActive(): void {
        if (this.#disposed) {
            throw new Error("The NodeAssetCoordinator has been disposed.");
        }
    }
}
