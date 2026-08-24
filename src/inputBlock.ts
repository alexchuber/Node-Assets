import { type ConnectionPoint } from "./connectionPoint";
import { createNodeAssetBlockError, getNodeAssetBlockBuildState, getNodeAssetBlockErrorReason, NodeAssetBlock } from "./nodeAssetBlock";

export type InputSource = string | ArrayBuffer | ArrayBufferView;

export class InputBlock extends NodeAssetBlock {
    public readonly output: ConnectionPoint<"File", "output">;
    public source: InputSource | undefined;

    public constructor(name: string) {
        super(name);
        this.output = this.registerOutput("output", "File");
    }

    protected override async _buildAsync(): Promise<void> {
        const state = getNodeAssetBlockBuildState(this);
        state._throwIfDisposed();
        const source = this.source;
        if (source instanceof Uint8Array) {
            this.writeOutput(this.output, source);
            return;
        }

        if (source instanceof ArrayBuffer) {
            this.writeOutput(this.output, new Uint8Array(source));
            return;
        }

        if (ArrayBuffer.isView(source)) {
            this.writeOutput(this.output, new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
            return;
        }

        if (typeof source !== "string") {
            throw createNodeAssetBlockError(this, `Input block "${this.name}" requires a URL string or in-memory bytes source.`, undefined);
        }

        try {
            // Babylon's LoadFile helper relies on XMLHttpRequest and registers global file-tool hooks, so use fetch for headless, side-effect-free loading.
            const response = await fetch(source, { signal: state._abortSignal });
            if (!response.ok) {
                const status = response.statusText === "" ? String(response.status) : `${response.status} ${response.statusText}`;
                throw new Error(`Received HTTP ${status}.`);
            }

            const bytes = new Uint8Array(await response.arrayBuffer());
            this.writeOutput(this.output, bytes);
            const rootUrl = getUrlDirectory(response.url || source);
            if (rootUrl !== undefined) {
                state._setFileRootUrl(bytes, rootUrl);
            }
        } catch (error) {
            state._throwIfDisposed();
            throw createNodeAssetBlockError(this, `Input block "${this.name}" failed to load URL "${source}": ${getNodeAssetBlockErrorReason(error)}`, error);
        }
    }
}

function getUrlDirectory(url: string): string | undefined {
    try {
        return new URL(".", url).href;
    } catch {
        return undefined;
    }
}
