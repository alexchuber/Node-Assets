import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Geometry } from "@babylonjs/core/Meshes/geometry.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";
import type * as SceneLoaderTypes from "@babylonjs/core/Loading/sceneLoader.js";
import { describe, expect, it, vi } from "vitest";

import { InputBlock, NodeAsset, OutputBlock, ParseGLBBlock, SerializeGLBBlock } from "../src/index";
import { createGlbFixtureAsync, readGlbStructureAsync, readGlbStructureWithSwappedFirstTriangleAsync } from "./glbFixture";

type ImportMeshAsync = typeof SceneLoaderTypes.ImportMeshAsync;
type ImportMeshAsyncArguments = Parameters<ImportMeshAsync>;
type ImportMeshAsyncOverride = (...args: ImportMeshAsyncArguments) => ReturnType<ImportMeshAsync>;

const publicImportCalls = vi.hoisted(() => [] as ImportMeshAsyncArguments[]);
const publicImportOverride = vi.hoisted<{ current: ImportMeshAsyncOverride | undefined }>(() => ({ current: undefined }));

vi.mock("@babylonjs/core/Loading/sceneLoader.js", async () => {
    const actual = await vi.importActual<typeof SceneLoaderTypes>("@babylonjs/core/Loading/sceneLoader.js");
    return {
        ...actual,
        ImportMeshAsync: vi.fn((...args: ImportMeshAsyncArguments) => {
            publicImportCalls.push(args);
            return publicImportOverride.current?.(...args) ?? actual.ImportMeshAsync(...args);
        }),
    };
});

describe("GLB roundtrip", () => {
    it("roundtrips an in-memory GLB through the public block chain", async () => {
        const fixture = await createGlbFixtureAsync();
        const result = await buildRoundtripAsync(fixture.bytes);

        expect(new TextDecoder().decode(result.subarray(0, 4))).toBe("glTF");
        expect(new DataView(result.buffer, result.byteOffset, result.byteLength).getUint32(4, true)).toBe(2);
        expect(await readGlbStructureAsync(result)).toEqual(fixture.structure);
    });

    it("imports GLBs through Babylon's public scene-loader helper", async () => {
        const fixture = await createGlbFixtureAsync();
        publicImportCalls.length = 0;

        try {
            await buildRoundtripAsync(fixture.bytes);

            expect(publicImportCalls).toHaveLength(1);
            const [source, , options] = publicImportCalls[0] ?? [];
            expect(source).toBe(fixture.bytes);
            expect(options).toMatchObject({
                name: "parse.glb",
                pluginExtension: ".glb",
            });
        } finally {
            publicImportCalls.length = 0;
        }
    });

    it("emits a GLB with a valid header and JSON/BIN chunk layout", async () => {
        const fixture = await createGlbFixtureAsync();
        const result = await buildRoundtripAsync(fixture.bytes);
        const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
        const jsonChunkLength = view.getUint32(12, true);
        const jsonChunkType = view.getUint32(16, true);
        const binChunkOffset = 20 + jsonChunkLength;
        const binChunkLength = view.getUint32(binChunkOffset, true);
        const binChunkType = view.getUint32(binChunkOffset + 4, true);

        expect(result.byteLength % 4).toBe(0);
        expect(view.getUint32(8, true)).toBe(result.byteLength);
        expect(jsonChunkLength % 4).toBe(0);
        expect(jsonChunkType).toBe(0x4e4f534a);
        expect(binChunkLength % 4).toBe(0);
        expect(binChunkType).toBe(0x004e4942);
        expect(binChunkOffset + 8 + binChunkLength).toBe(result.byteLength);
    });

    it("preserves mesh topology, dimensions, material color, and transforms", async () => {
        const fixture = await createGlbFixtureAsync();
        const result = await buildRoundtripAsync(fixture.bytes);
        const structure = await readGlbStructureAsync(result);

        expect(structure.materials).toHaveLength(1);
        const material = structure.materials[0];
        if (material === undefined) {
            throw new Error("Expected the fixture material to reload.");
        }

        expect(material.name).toBe("fixture-material");
        expect(material.type).toBe("PBRMaterial");
        expectVectorToBeClose(material.baseColor, [0.2, 0.4, 0.6]);

        expect(structure.meshes).toHaveLength(1);
        const mesh = structure.meshes[0];
        if (mesh === undefined) {
            throw new Error("Expected the fixture mesh to reload.");
        }

        expect(mesh.name).toBe("fixture-box");
        expect(mesh.materialName).toBe("fixture-material");
        expect(mesh.vertexCount).toBe(24);
        expect(mesh.indexCount).toBe(36);
        expectVectorToBeClose(mesh.dimensions, [2, 2, 2]);
        expectVectorToBeClose(mesh.position, [3, -2, 5]);
        expectVectorToBeClose(mesh.rotationQuaternion, [0.034270798550482096, -0.10602051106179565, 0.1534393020242226, 0.981856172866081]);
        expectVectorToBeClose(mesh.scaling, [1.5, 0.75, 2]);
        expect(mesh.triangleSignatures).toEqual(fixture.structure.meshes[0]?.triangleSignatures);
    });

    it("detects swapped triangle indices even when counts and bounds match", async () => {
        const fixture = await createGlbFixtureAsync();
        const originalMesh = fixture.structure.meshes[0];
        if (originalMesh === undefined) {
            throw new Error("Expected the fixture mesh.");
        }

        const swapped = await readGlbStructureWithSwappedFirstTriangleAsync(fixture.bytes);
        const swappedMesh = swapped.meshes[0];
        if (swappedMesh === undefined) {
            throw new Error("Expected the swapped fixture mesh.");
        }

        expect(swappedMesh.vertexCount).toBe(originalMesh.vertexCount);
        expect(swappedMesh.indexCount).toBe(originalMesh.indexCount);
        expectVectorToBeClose(swappedMesh.dimensions, originalMesh.dimensions);
        expect(swappedMesh.triangleSignatures).not.toEqual(originalMesh.triangleSignatures);
    });

    it("supports repeated builds with fresh headless scenes and engines", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");

        input.source = fixture.bytes;
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        try {
            await asset.buildAsync();
            const firstResult = output.data;
            await asset.buildAsync();
            const secondResult = output.data;

            expect(secondResult).not.toBe(firstResult);
            expect(await readGlbStructureAsync(firstResult)).toEqual(fixture.structure);
            expect(await readGlbStructureAsync(secondResult)).toEqual(fixture.structure);
        } finally {
            asset.dispose();
        }
    });

    it("disposes parsed resources exactly once after a successful serialization", async () => {
        const fixture = await createGlbFixtureAsync();
        publicImportCalls.length = 0;
        const containerDispose = vi.spyOn(AssetContainer.prototype, "dispose");
        const meshDispose = vi.spyOn(Mesh.prototype, "dispose");
        const geometryDispose = vi.spyOn(Geometry.prototype, "dispose");
        const sceneDispose = vi.spyOn(Scene.prototype, "dispose");
        const engineDispose = vi.spyOn(NullEngine.prototype, "dispose");

        try {
            await buildRoundtripAsync(fixture.bytes);

            expect(publicImportCalls).toHaveLength(1);
            expect(containerDispose).toHaveBeenCalledTimes(1);
            expect(meshDispose).toHaveBeenCalled();
            expect(new Set(meshDispose.mock.instances).size).toBe(meshDispose.mock.calls.length);
            expect(geometryDispose).toHaveBeenCalled();
            expect(new Set(geometryDispose.mock.instances).size).toBe(geometryDispose.mock.calls.length);
            expect(sceneDispose).toHaveBeenCalledTimes(1);
            expect(engineDispose).toHaveBeenCalledTimes(1);
        } finally {
            publicImportCalls.length = 0;
            geometryDispose.mockRestore();
            meshDispose.mockRestore();
            containerDispose.mockRestore();
            sceneDispose.mockRestore();
            engineDispose.mockRestore();
        }
    });

    it("disposes parsed resources exactly once when serialization fails", async () => {
        const fixture = await createGlbFixtureAsync();
        publicImportCalls.length = 0;
        const containerDispose = vi.spyOn(AssetContainer.prototype, "dispose");
        const meshDispose = vi.spyOn(Mesh.prototype, "dispose");
        const geometryDispose = vi.spyOn(Geometry.prototype, "dispose");
        const sceneDispose = vi.spyOn(Scene.prototype, "dispose");
        const engineDispose = vi.spyOn(NullEngine.prototype, "dispose");
        const serialize = vi.spyOn(GLTF2Export, "GLBAsync").mockRejectedValue(new Error("forced serializer failure"));

        try {
            await expect(buildRoundtripAsync(fixture.bytes)).rejects.toThrow('Serialize GLB block "serialize" failed: forced serializer failure');
            expect(publicImportCalls).toHaveLength(1);
            expect(containerDispose).toHaveBeenCalledTimes(1);
            expect(meshDispose).toHaveBeenCalled();
            expect(new Set(meshDispose.mock.instances).size).toBe(meshDispose.mock.calls.length);
            expect(geometryDispose).toHaveBeenCalled();
            expect(new Set(geometryDispose.mock.instances).size).toBe(geometryDispose.mock.calls.length);
            expect(sceneDispose).toHaveBeenCalledTimes(1);
            expect(engineDispose).toHaveBeenCalledTimes(1);
        } finally {
            publicImportCalls.length = 0;
            serialize.mockRestore();
            geometryDispose.mockRestore();
            meshDispose.mockRestore();
            containerDispose.mockRestore();
            sceneDispose.mockRestore();
            engineDispose.mockRestore();
        }
    });

    it("disposes resources allocated before import failure exactly once", async () => {
        const fixture = await createGlbFixtureAsync();
        publicImportCalls.length = 0;
        const disposalOrder: string[] = [];
        const originalContainerDispose = captureDispose(AssetContainer.prototype);
        const originalMeshDispose = captureDispose(Mesh.prototype);
        const originalGeometryDispose = captureDispose(Geometry.prototype);
        const originalSceneDispose = captureDispose(Scene.prototype);
        const originalEngineDispose = captureDispose(NullEngine.prototype);
        const containerDispose = vi.spyOn(AssetContainer.prototype, "dispose").mockImplementation(function (this: AssetContainer): void {
            disposalOrder.push("container");
            originalContainerDispose(this);
        });
        const meshDispose = vi.spyOn(Mesh.prototype, "dispose").mockImplementation(function (this: Mesh): void {
            disposalOrder.push("mesh");
            originalMeshDispose(this);
        });
        const geometryDispose = vi.spyOn(Geometry.prototype, "dispose").mockImplementation(function (this: Geometry): void {
            disposalOrder.push("geometry");
            originalGeometryDispose(this);
        });
        const sceneDispose = vi.spyOn(Scene.prototype, "dispose").mockImplementation(function (this: Scene): void {
            originalSceneDispose(this);
            disposalOrder.push("scene");
        });
        const engineDispose = vi.spyOn(NullEngine.prototype, "dispose").mockImplementation(function (this: NullEngine): void {
            disposalOrder.push("engine");
            originalEngineDispose(this);
        });
        publicImportOverride.current = (_source, scene) => {
            MeshBuilder.CreateBox("partial-import", { size: 1 }, scene);
            return Promise.reject(new Error("forced import failure"));
        };

        try {
            await expect(buildRoundtripAsync(fixture.bytes)).rejects.toThrow('Parse GLB block "parse" failed: forced import failure');
            expect(publicImportCalls).toHaveLength(1);
            expect(disposalOrder).toEqual(["container", "mesh", "geometry", "scene", "engine"]);
            expect(containerDispose).toHaveBeenCalledTimes(1);
            expect(meshDispose).toHaveBeenCalledTimes(1);
            expect(geometryDispose).toHaveBeenCalledTimes(1);
            expect(sceneDispose).toHaveBeenCalledTimes(1);
            expect(engineDispose).toHaveBeenCalledTimes(1);
        } finally {
            publicImportOverride.current = undefined;
            publicImportCalls.length = 0;
            geometryDispose.mockRestore();
            meshDispose.mockRestore();
            containerDispose.mockRestore();
            sceneDispose.mockRestore();
            engineDispose.mockRestore();
        }
    });

    it("disposes resources allocated before completion failure exactly once", async () => {
        const fixture = await createGlbFixtureAsync();
        publicImportCalls.length = 0;
        const disposalOrder: string[] = [];
        const originalContainerDispose = captureDispose(AssetContainer.prototype);
        const originalMeshDispose = captureDispose(Mesh.prototype);
        const originalGeometryDispose = captureDispose(Geometry.prototype);
        const originalSceneDispose = captureDispose(Scene.prototype);
        const originalEngineDispose = captureDispose(NullEngine.prototype);
        const containerDispose = vi.spyOn(AssetContainer.prototype, "dispose").mockImplementation(function (this: AssetContainer): void {
            disposalOrder.push("container");
            originalContainerDispose(this);
        });
        const meshDispose = vi.spyOn(Mesh.prototype, "dispose").mockImplementation(function (this: Mesh): void {
            disposalOrder.push("mesh");
            originalMeshDispose(this);
        });
        const geometryDispose = vi.spyOn(Geometry.prototype, "dispose").mockImplementation(function (this: Geometry): void {
            disposalOrder.push("geometry");
            originalGeometryDispose(this);
        });
        const sceneDispose = vi.spyOn(Scene.prototype, "dispose").mockImplementation(function (this: Scene): void {
            originalSceneDispose(this);
            disposalOrder.push("scene");
        });
        const engineDispose = vi.spyOn(NullEngine.prototype, "dispose").mockImplementation(function (this: NullEngine): void {
            disposalOrder.push("engine");
            originalEngineDispose(this);
        });
        publicImportOverride.current = async (_source, scene) => {
            const mesh = MeshBuilder.CreateBox("partial-completion", { size: 1 }, scene);
            await Promise.resolve();
            throw new Error(`forced import completion failure after ${mesh.name} allocation`);
        };

        try {
            await expect(buildRoundtripAsync(fixture.bytes)).rejects.toThrow(
                'Parse GLB block "parse" failed: forced import completion failure after partial-completion allocation'
            );
            expect(publicImportCalls).toHaveLength(1);
            expect(disposalOrder).toEqual(["container", "mesh", "geometry", "scene", "engine"]);
            expect(containerDispose).toHaveBeenCalledTimes(1);
            expect(meshDispose).toHaveBeenCalledTimes(1);
            expect(geometryDispose).toHaveBeenCalledTimes(1);
            expect(sceneDispose).toHaveBeenCalledTimes(1);
            expect(engineDispose).toHaveBeenCalledTimes(1);
        } finally {
            publicImportOverride.current = undefined;
            publicImportCalls.length = 0;
            geometryDispose.mockRestore();
            meshDispose.mockRestore();
            containerDispose.mockRestore();
            sceneDispose.mockRestore();
            engineDispose.mockRestore();
        }
    });

    it("includes the parse block name when loading fails", async () => {
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");

        input.source = new Uint8Array([0, 1, 2, 3]);
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        await expect(asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed');
        expect(() => output.data).toThrow('Output block "destination"');

        asset.dispose();
    });

    it("clears failed GLB output and permits a later rebuild", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");

        input.source = fixture.bytes;
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        try {
            await asset.buildAsync();
            input.source = new Uint8Array([0, 1, 2, 3]);
            await expect(asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed');
            expect(() => output.data).toThrow('Output block "destination"');

            input.source = fixture.bytes;
            await asset.buildAsync();
            expect(await readGlbStructureAsync(output.data)).toEqual(fixture.structure);
        } finally {
            asset.dispose();
        }
    });
});

async function buildRoundtripAsync(source: Uint8Array): Promise<Uint8Array> {
    const input = new InputBlock("source");
    const parse = new ParseGLBBlock("parse");
    const serialize = new SerializeGLBBlock("serialize");
    const output = new OutputBlock("destination");
    const asset = new NodeAsset("graph");

    input.source = source;
    input.output.connectTo(parse.input);
    parse.output.connectTo(serialize.input);
    serialize.output.connectTo(output.input);
    asset.addOutputBlock(output);

    try {
        await asset.buildAsync();
        return output.data;
    } finally {
        asset.dispose();
    }
}

function expectVectorToBeClose(actual: readonly number[], expected: readonly number[]): void {
    expect(actual).toHaveLength(expected.length);
    for (const [index, expectedValue] of expected.entries()) {
        expect(actual[index]).toBeCloseTo(expectedValue, 5);
    }
}

function captureDispose<T extends { dispose(): void }>(prototype: T): (instance: T) => void {
    let current: object | null = prototype;
    while (current !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(current, "dispose");
        if (descriptor !== undefined) {
            if (typeof descriptor.value !== "function") {
                throw new Error("Expected a disposable prototype method.");
            }

            const dispose = descriptor.value as (this: T) => void;
            return (instance) => {
                Reflect.apply(dispose, instance, []);
            };
        }

        current = Reflect.getPrototypeOf(current);
    }

    throw new Error("Expected a disposable prototype method.");
}
