import { Document } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRDracoMeshCompression, KHRTextureBasisu } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";

import { decodeMs, features } from "../../packages/cli/src/loadModel";
import { decoderBytes, docSummary, extensionsOf, gpuEstimate, loadSeconds, validateAsync } from "../../packages/cli/src/measure";
import { createGridDocument } from "../helpers/document";
import { generateGlbData } from "../helpers/gltf";

describe("CLI model measurements", () => {
    it("uses the measured Babylon decoder sizes without double-counting", () => {
        expect(decoderBytes(["draco"])).toBe(74865);
        expect(decoderBytes(["meshopt"])).toBe(6694);
        expect(decoderBytes(["ktx2"])).toBe(264668);
        expect(decoderBytes(["draco", "draco", "meshopt", "ktx2"])).toBe(346227);
        const doc = new Document();
        doc.createExtension(EXTMeshoptCompression).setRequired(true);
        doc.createExtension(KHRDracoMeshCompression).setRequired(true);
        doc.createExtension(KHRTextureBasisu).setRequired(true);
        expect(extensionsOf(doc).decoders.sort()).toEqual(["draco", "ktx2", "meshopt"]);
    });

    it("estimates stored vertex buffers and triangle counts", () => {
        const doc = createGridDocument(1);
        expect(gpuEstimate(doc)).toEqual({ textures: 0, geometry: 108, total: 108 });
        expect(docSummary(doc)).toMatchObject({ triangles: 2, vertices: 4, textures: "none" });
    });

    it("keeps load estimates deterministic and includes network and decoder downloads", () => {
        const doc = createGridDocument(1);
        const baseline = loadSeconds(doc, 1000, "4g");
        expect(baseline).toBe(8000 / 9e6 + decodeMs(features(doc, 1000)) / 1000);
        expect(loadSeconds(doc, 1000, "slow-4g")).toBeGreaterThan(baseline);
        doc.createExtension(KHRDracoMeshCompression).setRequired(true);
        expect(loadSeconds(doc, 1000, "4g", 2)).toBeLessThan(loadSeconds(doc, 1000, "4g", 1));
    });

    it("validates a generated GLB and reports unreadable input", async () => {
        expect((await validateAsync(generateGlbData())).errors).toBe(0);
        expect((await validateAsync(new Uint8Array(3))).errors).toBeGreaterThan(0);
    });
});
