import type { _BlockRuntime, Block } from "../block/block";
import type { _InputBlockDefinition } from "../block/blockDefinition";
import type { ConnectionPointValue } from "../block/connectionPointType";
import type { NodeAsset } from "./nodeAsset";

type AnyBlock = _BlockRuntime;

/** Supplies per-execution values for a node asset's unconnected inputs. */
export class NodeAssetContext<TAsset extends NodeAsset<AnyBlock>> {
    readonly #asset: TAsset;
    readonly #inputs = new Map<AnyBlock, unknown>();

    public constructor(asset: TAsset) {
        this.#asset = asset;
    }

    /** Sets a block input for executions that use this context. */
    public setInput<TDefinition extends _InputBlockDefinition>(block: Block<TDefinition>, value: ConnectionPointValue<TDefinition["input"]>): void {
        if (!this.#asset._hasBlock(block)) {
            throw new Error(`Block "${block.name}" does not belong to this NodeAsset.`);
        }
        const input = block.input;
        if (input === undefined) {
            throw new Error(`Block "${block.name}" does not accept an input.`);
        }
        if (input._source !== undefined) {
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
