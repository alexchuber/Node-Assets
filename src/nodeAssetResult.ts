import type { Block } from "./blocks/block";
import type { _AnyBlockDefinition } from "./blocks/blockDefinition";
import type { ConnectionPointValue } from "./connectionPointType";

type AnyBlock = Block<_AnyBlockDefinition>;

export class NodeAssetResult<TOutput extends AnyBlock> {
    public constructor(
        public readonly outputBlock: TOutput,
        public readonly output: ConnectionPointValue<TOutput["_definition"]["output"]>
    ) {}
}
