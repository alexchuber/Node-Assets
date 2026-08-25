import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Scene } from "@babylonjs/core/scene.js";

export interface SceneStructure {
    readonly meshes: readonly MeshStructure[];
    readonly materials: readonly MaterialStructure[];
}

export interface MaterialStructure {
    readonly baseColor: readonly [number, number, number];
    readonly name: string;
    readonly type: string;
}

export interface MeshStructure {
    readonly dimensions: readonly [number, number, number];
    readonly indexCount: number;
    readonly materialName: string | null;
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationQuaternion: readonly [number, number, number, number];
    readonly scaling: readonly [number, number, number];
    readonly triangleSignatures: readonly string[];
    readonly vertexCount: number;
}

export interface GlbFixture {
    readonly bytes: Uint8Array;
    readonly structure: SceneStructure;
}

export const GLB_FIXTURE_STRUCTURE: SceneStructure = {
    materials: [
        {
            baseColor: [0.2, 0.4, 0.6],
            name: "fixture-material",
            type: "PBRMaterial",
        },
    ],
    meshes: [
        {
            dimensions: [2, 2, 0],
            indexCount: 3,
            materialName: "fixture-material",
            name: "fixture-triangle",
            position: [3, -2, 5],
            rotationQuaternion: [0.034270798550482096, -0.10602051106179565, 0.1534393020242226, 0.981856172866081],
            scaling: [1.5, 0.75, 2],
            triangleSignatures: ["-1,-1,0,0,0,1|1,-1,0,0,0,1|0,1,0,0,0,1"],
            vertexCount: 3,
        },
    ],
};

export function createGlbFixtureAsync(): Promise<GlbFixture> {
    return Promise.resolve({
        bytes: createIndependentGlb(),
        structure: GLB_FIXTURE_STRUCTURE,
    });
}

function createIndependentGlb(): Uint8Array {
    const binaryByteLength = 78;
    const binaryChunk = new Uint8Array(80);
    const binaryView = new DataView(binaryChunk.buffer);
    const positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0];
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    for (const [index, value] of positions.entries()) {
        binaryView.setFloat32(index * 4, value, true);
    }
    for (const [index, value] of normals.entries()) {
        binaryView.setFloat32(36 + index * 4, value, true);
    }
    for (const [index, value] of [0, 1, 2].entries()) {
        binaryView.setUint16(72 + index * 2, value, true);
    }

    const document = {
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: 3,
                max: [1, 1, 0],
                min: [-1, -1, 0],
                type: "VEC3",
            },
            {
                bufferView: 1,
                componentType: 5126,
                count: 3,
                type: "VEC3",
            },
            {
                bufferView: 2,
                componentType: 5123,
                count: 3,
                max: [2],
                min: [0],
                type: "SCALAR",
            },
        ],
        asset: {
            generator: "independent-node-assets-test-fixture",
            version: "2.0",
        },
        bufferViews: [
            { buffer: 0, byteLength: 36, byteOffset: 0, target: 34962 },
            { buffer: 0, byteLength: 36, byteOffset: 36, target: 34962 },
            { buffer: 0, byteLength: 6, byteOffset: 72, target: 34963 },
        ],
        buffers: [{ byteLength: binaryByteLength }],
        materials: [
            {
                name: "fixture-material",
                pbrMetallicRoughness: {
                    baseColorFactor: [0.2, 0.4, 0.6, 1],
                    metallicFactor: 0,
                    roughnessFactor: 1,
                },
            },
        ],
        meshes: [
            {
                name: "fixture-triangle",
                primitives: [
                    {
                        attributes: {
                            NORMAL: 1,
                            POSITION: 0,
                        },
                        indices: 2,
                        material: 0,
                    },
                ],
            },
        ],
        nodes: [
            {
                mesh: 0,
                name: "fixture-triangle",
                rotation: [0.034270798550482096, -0.10602051106179565, 0.1534393020242226, 0.981856172866081],
                scale: [1.5, 0.75, 2],
                translation: [3, -2, 5],
            },
        ],
        scene: 0,
        scenes: [{ nodes: [0] }],
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
    const jsonChunkLength = alignToFourBytes(jsonBytes.byteLength);
    const totalByteLength = 12 + 8 + jsonChunkLength + 8 + binaryChunk.byteLength;
    const result = new Uint8Array(totalByteLength);
    const resultView = new DataView(result.buffer);

    resultView.setUint32(0, 0x46546c67, true);
    resultView.setUint32(4, 2, true);
    resultView.setUint32(8, totalByteLength, true);
    resultView.setUint32(12, jsonChunkLength, true);
    resultView.setUint32(16, 0x4e4f534a, true);
    result.set(jsonBytes, 20);
    result.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonChunkLength);

    const binaryHeaderOffset = 20 + jsonChunkLength;
    resultView.setUint32(binaryHeaderOffset, binaryChunk.byteLength, true);
    resultView.setUint32(binaryHeaderOffset + 4, 0x004e4942, true);
    result.set(binaryChunk, binaryHeaderOffset + 8);
    return result;
}

function alignToFourBytes(value: number): number {
    return (value + 3) & ~3;
}

export async function readGlbStructureAsync(bytes: Uint8Array): Promise<SceneStructure> {
    await registerGlbLoaderAsync();

    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;

    try {
        const container = await LoadAssetContainerAsync(bytes, scene, {
            name: "fixture.glb",
            pluginExtension: ".glb",
        });
        container.addAllToScene();
        return readSceneStructure(scene);
    } finally {
        scene.dispose();
        engine.dispose();
    }
}

export async function readGlbStructureWithSwappedFirstTriangleAsync(bytes: Uint8Array): Promise<SceneStructure> {
    await registerGlbLoaderAsync();

    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;

    try {
        const container = await LoadAssetContainerAsync(bytes, scene, {
            name: "fixture.glb",
            pluginExtension: ".glb",
        });
        container.addAllToScene();
        const mesh = scene.meshes.find((candidate) => candidate.getTotalVertices() > 0);
        if (mesh === undefined) {
            throw new Error("Expected the fixture mesh to reload.");
        }

        const indices = mesh.getIndices();
        if (indices === null || indices.length < 3) {
            throw new Error("Expected the fixture mesh to have a triangle.");
        }

        const first = indices[1];
        const second = indices[2];
        if (first === undefined || second === undefined) {
            throw new Error("Expected the fixture triangle indices to be readable.");
        }

        const swappedIndices = indices.slice();
        swappedIndices[1] = second;
        swappedIndices[2] = first;
        mesh.setIndices(swappedIndices, mesh.getTotalVertices());
        return readSceneStructure(scene);
    } finally {
        scene.dispose();
        engine.dispose();
    }
}

async function registerGlbLoaderAsync(): Promise<void> {
    await import("@babylonjs/loaders/glTF/2.0/glTFLoader.js");
}

function readSceneStructure(scene: Scene): SceneStructure {
    return {
        materials: scene.materials
            .map((material) => {
                if (!(material instanceof PBRMaterial)) {
                    throw new Error(`Expected fixture material to reload as PBRMaterial, got ${material.getClassName()}.`);
                }

                return {
                    baseColor: toTuple3(material.albedoColor.r, material.albedoColor.g, material.albedoColor.b),
                    name: material.name,
                    type: material.getClassName(),
                };
            })
            .sort((left, right) => left.name.localeCompare(right.name)),
        meshes: scene.meshes
            .filter((mesh) => mesh.getTotalVertices() > 0)
            .map((mesh) => ({
                dimensions: toTuple3(
                    mesh.getBoundingInfo().boundingBox.extendSize.x * 2,
                    mesh.getBoundingInfo().boundingBox.extendSize.y * 2,
                    mesh.getBoundingInfo().boundingBox.extendSize.z * 2
                ),
                indexCount: mesh.getTotalIndices(),
                materialName: mesh.material?.name ?? null,
                name: mesh.name,
                position: toTuple3(mesh.position.x, mesh.position.y, mesh.position.z),
                rotationQuaternion:
                    mesh.rotationQuaternion === null
                        ? toTuple4(0, 0, 0, 1)
                        : toTuple4(mesh.rotationQuaternion.x, mesh.rotationQuaternion.y, mesh.rotationQuaternion.z, mesh.rotationQuaternion.w),
                scaling: toTuple3(mesh.scaling.x, mesh.scaling.y, mesh.scaling.z),
                triangleSignatures: getTriangleSignatures(mesh),
                vertexCount: mesh.getTotalVertices(),
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}

function getTriangleSignatures(mesh: AbstractMesh): readonly string[] {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
    const indices = mesh.getIndices();
    if (positions === null || normals === null || indices === null || indices.length % 3 !== 0) {
        throw new Error(`Expected mesh "${mesh.name}" to have complete triangle data.`);
    }

    const signatures: string[] = [];
    for (let index = 0; index < indices.length; index += 3) {
        const first = indices[index];
        const second = indices[index + 1];
        const third = indices[index + 2];
        if (first === undefined || second === undefined || third === undefined) {
            throw new Error(`Expected mesh "${mesh.name}" triangle indices to be readable.`);
        }

        signatures.push([first, second, third].map((vertexIndex) => formatTriangleVertex(positions, normals, vertexIndex)).join("|"));
    }

    return signatures.sort();
}

function formatTriangleVertex(positions: ArrayLike<number>, normals: ArrayLike<number>, vertexIndex: number): string {
    const offset = vertexIndex * 3;
    return [
        readArrayValue(positions, offset),
        readArrayValue(positions, offset + 1),
        readArrayValue(positions, offset + 2),
        readArrayValue(normals, offset),
        readArrayValue(normals, offset + 1),
        readArrayValue(normals, offset + 2),
    ]
        .map((value) => String(Number(value.toFixed(6))))
        .join(",");
}

function readArrayValue(values: ArrayLike<number>, index: number): number {
    const value = values[index];
    if (value === undefined) {
        throw new Error("Expected mesh vertex data to be complete.");
    }

    return value;
}

function toTuple3(x: number, y: number, z: number): [number, number, number] {
    return [x, y, z];
}

function toTuple4(x: number, y: number, z: number, w: number): [number, number, number, number] {
    return [x, y, z, w];
}
