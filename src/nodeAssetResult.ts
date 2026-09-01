import type { Block } from "./blocks/block";
import type { _AnyBlockDefinition } from "./blocks/blockDefinition";
import type { RuntimeData } from "./connectionPointType";

type AnyBlock = Block<_AnyBlockDefinition>;

export class NodeAssetResult<TOutput extends AnyBlock> {
    public constructor(
        public readonly outputBlock: TOutput,
        public readonly output: RuntimeData<TOutput["definition"]["output"]>
    ) {}
}
