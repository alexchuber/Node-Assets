import type { Block } from "./blocks/block";
import type { _AnyBlockDefinition } from "./blocks/blockDefinition";
import type { ConnectionPointValue } from "./connectionPointType";
import type { NodeAsset } from "./nodeAsset";

type AnyBlock = Block<_AnyBlockDefinition>;

export class NodeAssetContext<TAsset extends NodeAsset<AnyBlock>> {
    readonly #asset: TAsset;
    readonly #inputs = new Map<AnyBlock, unknown>();

    public constructor(asset: TAsset) {
        this.#asset = asset;
    }

    public setInput<TDefinition extends _AnyBlockDefinition>(block: Block<TDefinition>, value: ConnectionPointValue<TDefinition["input"]>): void {
        if (!this.#asset._hasBlock(block)) {
            throw new Error(`Block "${block.name}" does not belong to this NodeAsset.`);
        }
        if (block.input._source !== undefined) {
            throw new Error(`Block "${block.name}" has a connected input.`);
        }
        if (!block._definition.input.is(value)) {
            throw new Error(`Block "${block.name}" expected value type "${block._definition.input.id}".`);
        }
        this.#inputs.set(block, value);
    }

    /** @internal */
    public _snapshot(): Map<AnyBlock, unknown> {
        return new Map(this.#inputs);
    }
}
