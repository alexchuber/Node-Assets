import type { Block } from "./blocks/block";
import type { _AnyBlockDefinition } from "./blocks/blockDefinition";
import type { ConnectionPointValue } from "./connectionPointType";

type AnyBlock = Block<_AnyBlockDefinition>;

/** The typed terminal output produced by executing a node asset. */
export class NodeAssetResult<TOutput extends AnyBlock> {
    public constructor(
        /** The terminal block that produced the result. */
        public readonly outputBlock: TOutput,
        /** The value produced by the terminal block. */
        public readonly output: ConnectionPointValue<TOutput["_definition"]["output"]>
    ) {}
}
