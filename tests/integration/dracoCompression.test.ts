import type { IDracoCodecConfiguration } from "@babylonjs/core/Meshes/Compression/dracoCodec.js";
import type { DracoEncoder as BabylonDracoEncoder } from "@babylonjs/core/Meshes/Compression/dracoEncoder.js";

import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";

import { DracoEncoderBlock } from "../../src/blocks/dracoEncoderBlock";
import { GltfInputBlock } from "../../src/blocks/gltfInputBlock";
import { GltfOutputBlock } from "../../src/blocks/gltfOutputBlock";
import { NodeAsset } from "../../src/nodeAsset/nodeAsset";
import { generateGltfDataUri } from "../fixtures/gltf";

describe("Draco compression", () => {
    let originalConfiguration: IDracoCodecConfiguration;

    beforeAll(async () => {
        const { DracoEncoder } = await import("@babylonjs/core/Meshes/Compression/dracoEncoder.js");
        originalConfiguration = DracoEncoder.DefaultConfiguration;
        DracoEncoder.DefaultConfiguration = await createNodeDracoConfigurationAsync();
        DracoEncoder.ResetDefault();
    });

    afterAll(async () => {
        const { DracoEncoder } = await import("@babylonjs/core/Meshes/Compression/dracoEncoder.js");
        DracoEncoder.ResetDefault();
        DracoEncoder.DefaultConfiguration = originalConfiguration;
    });

    it("provides Babylon's default Draco encoder", async () => {
        const encoderBlock = new DracoEncoderBlock();
        const result = await new NodeAsset({ name: "draco-encoder", outputBlock: encoderBlock }).executeAsync();
        const { DracoEncoder } = await import("@babylonjs/core/Meshes/Compression/dracoEncoder.js");

        expectTypeOf(result).toEqualTypeOf<BabylonDracoEncoder>();
        expect(result).toBe(DracoEncoder.Default);
    });

    it("leaves unconnected glTF output uncompressed", async () => {
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);

        const result = await new NodeAsset({ name: "uncompressed-glb", outputBlock: destination }).executeAsync();
        const gltf = await readGlbJsonAsync(result);

        expect(result.type).toBe("model/gltf-binary");
        expect(gltf.extensionsUsed ?? []).not.toContain("KHR_draco_mesh_compression");
        expect(gltf.meshes[0]?.primitives[0]?.extensions?.KHR_draco_mesh_compression).toBeUndefined();
    });

    it("compresses connected glTF output with Draco", async () => {
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const encoder = new DracoEncoderBlock();
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);
        encoder.output.connectTo(destination.geometryCompressor);

        const result = await new NodeAsset({ name: "draco-compressed-glb", outputBlock: destination }).executeAsync();
        const gltf = await readGlbJsonAsync(result);

        expect(gltf.extensionsUsed).toContain("KHR_draco_mesh_compression");
        expect(gltf.meshes[0]?.primitives[0]?.extensions).toHaveProperty("KHR_draco_mesh_compression");
    });
});

interface GltfJson {
    readonly extensionsUsed?: readonly string[];
    readonly meshes: ReadonlyArray<{
        readonly primitives: ReadonlyArray<{
            readonly extensions?: Readonly<Record<string, unknown>>;
        }>;
    }>;
}

async function readGlbJsonAsync(file: File): Promise<GltfJson> {
    const data = await file.arrayBuffer();
    const view = new DataView(data);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a);
    const jsonLength = view.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, jsonLength)).trim()) as GltfJson;
}

async function createNodeDracoConfigurationAsync(): Promise<IDracoCodecConfiguration> {
    const [wrapperResponse, wasmResponse] = await Promise.all([
        fetch("https://cdn.babylonjs.com/draco_encoder_wasm_wrapper.js"),
        fetch("https://cdn.babylonjs.com/draco_encoder.wasm"),
    ]);
    if (!wrapperResponse.ok || !wasmResponse.ok) {
        throw new Error("Failed to load the Babylon.js Draco encoder.");
    }

    const wrapper = await wrapperResponse.text();
    const jsModule = new Function(`const process = undefined; const __dirname = "";\n${wrapper}\nreturn DracoEncoderModule;`)() as IDracoCodecConfiguration["jsModule"];
    return {
        jsModule,
        numWorkers: 0,
        wasmBinary: await wasmResponse.arrayBuffer(),
        wasmBinaryUrl: "injected",
        wasmUrl: "injected",
    };
}
