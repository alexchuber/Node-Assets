import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { Logger, NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco from "draco3dgltf";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

let ioPromise: Promise<NodeIO> | undefined;

export function getIOAsync(): Promise<NodeIO> {
    return (ioPromise ??= createIOAsync());
}

async function createIOAsync(): Promise<NodeIO> {
    const require = createRequire(import.meta.url);
    const [wasmBinary] = await Promise.all([readFile(require.resolve("draco3dgltf/draco_decoder_gltf.wasm")), MeshoptDecoder.ready, MeshoptEncoder.ready]);
    const [decoder, encoder] = await Promise.all([draco.createDecoderModule({ wasmBinary }), draco.createEncoderModule()]);
    return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
            "draco3d.decoder": decoder,
            "draco3d.encoder": encoder,
            "meshopt.decoder": MeshoptDecoder,
            "meshopt.encoder": MeshoptEncoder,
        })
        .setLogger(new Logger(Logger.Verbosity.SILENT));
}

export async function readDocAsync(bytes: Uint8Array): Promise<Document> {
    return (await getIOAsync()).readBinary(bytes);
}

export async function writeGlbAsync(document: Document): Promise<Uint8Array> {
    return (await getIOAsync()).writeBinary(document);
}
