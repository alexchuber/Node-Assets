import { GltfOutputBlock, NodeAsset, NodeAssetContext, type Graph } from "@babylonjs/node-assets";
import type { Document } from "@gltf-transform/core";

import { writeGlb } from "./document";
import { inputBlock } from "./inputs";
import { withDiagnostics } from "./output";

export async function executeGraph(graph: Graph, input: string | Document): Promise<Uint8Array> {
    if (typeof input !== "string") {
        return withDiagnostics(async () => writeGlb(await executeToDocument(graph, input)));
    }
    const destination = new GltfOutputBlock();
    const source = inputBlock(input);
    source.output.connectTo(graph.head.input);
    graph.tail.output.connectTo(destination.input);
    const asset = new NodeAsset({ name: "node-assets", outputBlock: destination });
    try {
        return await withDiagnostics(async () => new Uint8Array(await (await asset.executeAsync()).arrayBuffer()));
    } finally {
        asset.dispose();
        source.output.disconnectFrom(graph.head.input);
        graph.tail.output.disconnectFrom(destination.input);
    }
}

export async function executeToDocument(graph: Graph, input: Document): Promise<Document> {
    const asset = new NodeAsset({ name: "node-assets-document", outputBlock: graph.tail });
    const context = new NodeAssetContext(asset);
    context.setInput(graph.head, input);
    try {
        return await withDiagnostics(() => asset.executeAsync(context));
    } finally {
        asset.dispose();
    }
}
