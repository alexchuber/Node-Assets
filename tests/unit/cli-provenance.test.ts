import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

import { provenanceOf, withProvenance } from "../../packages/cli/src/provenance";
import { generateGlbData } from "../helpers/gltf";

describe("CLI GLB provenance", () => {
    it.each(["x", "xy", "xyz", "xyzw"])("preserves chunks and pads JSON for %s", (input) => {
        const original = Buffer.from(generateGlbData());
        const originalTail = original.subarray(20 + original.readUInt32LE(12));
        const metadata = { graph: "0123456789ab", input };
        const bytes = Buffer.from(withProvenance(original, metadata));
        const length = bytes.readUInt32LE(12);
        expect(bytes.readUInt32LE(8)).toBe(bytes.length);
        expect(length % 4).toBe(0);
        expect(bytes.subarray(20 + length)).toEqual(originalTail);
        expect(provenanceOf(bytes)).toEqual(metadata);
        const text = bytes.subarray(20, 20 + length).toString();
        expect(text.slice(text.lastIndexOf("}") + 1)).toMatch(/^ {0,3}$/);
        expect(JSON.parse(text).asset).toEqual({ version: "2.0" });
    });

    it("replaces provenance and preserves unrelated extras", async () => {
        const doc = await new NodeIO().readBinary(generateGlbData());
        doc.getRoot().setExtras({ other: { nested: [1, "value"] } });
        const original = Buffer.from(await new NodeIO().writeBinary(doc));
        const before = Buffer.from(original);
        const first = withProvenance(original, { graph: "first", input: "before" });
        const second = withProvenance(first, { graph: "second", input: "after" });
        expect(provenanceOf(second)).toEqual({ graph: "second", input: "after" });
        expect((await new NodeIO().readBinary(second)).getRoot().getExtras()).toMatchObject({ other: { nested: [1, "value"] } });
        expect(original).toEqual(before);
    });

    it("rejects malformed writes and ignores missing or malformed provenance", () => {
        expect(provenanceOf(generateGlbData())).toBeNull();
        expect(provenanceOf(new Uint8Array(3))).toBeNull();
        expect(() => withProvenance(new Uint8Array(3), { graph: "a", input: "b" })).toThrow();
        const truncated = generateGlbData().slice(0, 25);
        expect(() => withProvenance(truncated, { graph: "a", input: "b" })).toThrow();
    });
});
