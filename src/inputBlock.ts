import { type ConnectionPoint, type File } from "./connectionPoint";
import { NodeAssetBlock } from "./nodeAssetBlock";

export class InputBlock extends NodeAssetBlock {
    public readonly output: ConnectionPoint<"File", "output">;
    public source: File | undefined;

    public constructor(name: string) {
        super(name);
        this.output = this.registerOutput("output", "File");
    }

    protected override _buildAsync(): Promise<void> {
        const source = this.source;
        if (!(source instanceof Uint8Array)) {
            throw new Error(`Input block "${this.name}" requires an in-memory Uint8Array source.`);
        }

        this.writeOutput(this.output, source);
        return Promise.resolve();
    }
}
