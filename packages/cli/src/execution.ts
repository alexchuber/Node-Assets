import { GltfOutputBlock, NodeAsset, NodeAssetContext, type Graph } from "@babylonjs/node-assets";
import type { Document } from "@gltf-transform/core";

import { writeGlbAsync } from "./document";
import { inputBlock } from "./inputs";
import { withDiagnosticsAsync } from "./output";

export async function executeGraphAsync(graph: Graph, input: string | Document): Promise<Uint8Array> {
    if (typeof input !== "string") {
        return withDiagnosticsAsync(async () => writeGlbAsync(await executeToDocumentAsync(graph, input)));
    }
    const destination = new GltfOutputBlock();
    const source = inputBlock(input);
    source.output.connectTo(graph.head.input);
    graph.tail.output.connectTo(destination.input);
    const asset = new NodeAsset({ name: "node-assets", outputBlock: destination });
    try {
        return await withDiagnosticsAsync(async () => new Uint8Array(await (await asset.executeAsync()).arrayBuffer()));
    } finally {
        asset.dispose();
        source.output.disconnectFrom(graph.head.input);
        graph.tail.output.disconnectFrom(destination.input);
    }
}

export async function executeToDocumentAsync(graph: Graph, input: Document): Promise<Document> {
    const asset = new NodeAsset({ name: "node-assets-document", outputBlock: graph.tail });
    const context = new NodeAssetContext(asset);
    context.setInput(graph.head, input);
    try {
        return await withDiagnosticsAsync(() => asset.executeAsync(context));
    } finally {
        asset.dispose();
    }
}
