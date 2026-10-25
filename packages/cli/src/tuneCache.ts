import type { SerializedBlock } from "@babylonjs/node-assets";
import type { Document } from "@gltf-transform/core";
import { cloneDocument } from "@gltf-transform/functions";

import { readDoc } from "./document";
import { executeGraph, executeToDocument } from "./execution";
import { graphHash, instantiateGraph } from "./graphFiles";
import { stageBlocks, type TuneStages } from "./tuneStages";

export function createTuneExecutor() {
    const documents = new Map<string, Document>();
    const get = (key: string) => {
        const document = documents.get(key);
        if (document) {
            documents.delete(key);
            documents.set(key, document);
        }
        return document;
    };
    const put = (key: string, document: Document) => {
        documents.set(key, document);
        if (documents.size > 6) documents.delete(documents.keys().next().value!);
        return document;
    };
    return {
        clear: () => documents.clear(),
        async execute(hash: string, glb: Uint8Array, stages: TuneStages, maxTexture: number): Promise<Uint8Array> {
            const blocks = stageBlocks(stages, maxTexture);
            const prefixKey = (prefix: readonly SerializedBlock[]) => `${hash}:${graphHash({ graph: 1, blocks: prefix })}`;
            const cleanupKey = prefixKey(blocks.cleanup);
            const textureKey = blocks.textures.length ? prefixKey([...blocks.cleanup, ...blocks.textures]) : cleanupKey;
            let document = get(textureKey);
            if (!document) {
                document = get(cleanupKey);
                if (!document) {
                    let input = get(hash);
                    if (!input) {
                        input = await readDoc(glb);
                        input.disposeExtension("KHR_draco_mesh_compression");
                        input.disposeExtension("EXT_meshopt_compression");
                        put(hash, input);
                    }
                    document = put(cleanupKey, await executeToDocument(instantiateGraph({ graph: 1, blocks: blocks.cleanup }), cloneDocument(input)));
                }
                if (blocks.textures.length) {
                    document = put(textureKey, await executeToDocument(instantiateGraph({ graph: 1, blocks: blocks.textures }), cloneDocument(document)));
                }
            }
            return executeGraph(instantiateGraph({ graph: 1, blocks: blocks.geometry }), cloneDocument(document));
        },
    };
}
