import { describe, expect, it } from "vitest";
import { EXTTextureWebP } from "@gltf-transform/extensions";

import { readDocAsync } from "../../packages/cli/src/document";
import { executeGraphAsync } from "../../packages/cli/src/execution";
import { instantiateGraph } from "../../packages/cli/src/graphFiles";
import { createGridDocument, createRasterImageAsync } from "../helpers/document";

describe("CLI document execution", () => {
    it("runs a parsed graph against supplied documents without adding a file input", async () => {
        const graph = instantiateGraph({ graph: 1, blocks: [{ type: "transform.strip-materials" }] });
        const doc = createGridDocument(1);
        doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(doc.createMaterial());
        const bytes = await executeGraphAsync(graph, doc);
        const result = await readDocAsync(bytes);
        expect(result.getRoot().listMeshes()).toHaveLength(1);
        expect(result.getRoot().listMaterials()).toHaveLength(0);
        const next = await readDocAsync(await executeGraphAsync(graph, createGridDocument(1)));
        expect(next.getRoot().listMeshes()).toHaveLength(1);
    });

    it("preserves texture extensions when resuming after a cached texture stage", async () => {
        const doc = createGridDocument(1);
        doc.createExtension(EXTTextureWebP).setRequired(true);
        const texture = doc
            .createTexture()
            .setMimeType("image/webp")
            .setImage(await createRasterImageAsync("webp"));
        const material = doc.createMaterial().setBaseColorTexture(texture);
        doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(material);
        const graph = instantiateGraph({ graph: 1, blocks: [{ type: "transform.dedup" }] });
        const result = await readDocAsync(await executeGraphAsync(graph, doc));
        expect(
            result
                .getRoot()
                .listExtensionsRequired()
                .map((extension) => extension.extensionName)
        ).toContain("EXT_texture_webp");
        expect(result.getRoot().listTextures()).toHaveLength(1);
    });
});
