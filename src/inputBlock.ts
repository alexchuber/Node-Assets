import { type ConnectionPoint, type File } from "./connectionPoint";
import { NodeAssetBlock } from "./nodeAssetBlock";

export class InputBlock extends NodeAssetBlock {
    public readonly output: ConnectionPoint<"File", "output">;
    public source: File | ArrayBuffer | ArrayBufferView | undefined;

    public constructor(name: string) {
        super(name);
        this.output = this.registerOutput("output", "File");
    }

    protected override _buildAsync(): Promise<void> {
        const source = this.source;
        if (source === undefined) {
            throw new Error(`Input block "${this.name}" requires an in-memory Uint8Array, ArrayBuffer, or ArrayBufferView source.`);
        }

        if (source instanceof Uint8Array) {
            this.writeOutput(this.output, source);
        } else if (source instanceof ArrayBuffer) {
            this.writeOutput(this.output, new Uint8Array(source));
        } else if (ArrayBuffer.isView(source)) {
            this.writeOutput(this.output, new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
        } else {
            throw new Error(`Input block "${this.name}" requires an in-memory Uint8Array, ArrayBuffer, or ArrayBufferView source.`);
        }

        return Promise.resolve();
    }
}
