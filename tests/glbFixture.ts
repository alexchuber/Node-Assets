import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { PBRMetallicRoughnessMaterial } from "@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";

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
            dimensions: [2, 2, 2],
            indexCount: 36,
            materialName: "fixture-material",
            name: "fixture-box",
            position: [3, -2, 5],
            rotationQuaternion: [0.034270798550482096, -0.10602051106179565, 0.1534393020242226, 0.981856172866081],
            scaling: [1.5, 0.75, 2],
            vertexCount: 24,
        },
    ],
};

export async function createGlbFixtureAsync(): Promise<GlbFixture> {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;

    try {
        const box = MeshBuilder.CreateBox("fixture-box", { size: 2 }, scene);
        box.position.set(3, -2, 5);
        box.rotation.set(0.1, -0.2, 0.3);
        box.scaling.set(1.5, 0.75, 2);

        const material = new PBRMetallicRoughnessMaterial("fixture-material", scene);
        material.baseColor = new Color3(0.2, 0.4, 0.6);
        box.material = material;

        const data = await GLTF2Export.GLBAsync(scene, "fixture.glb");
        const file = data.files["fixture.glb"];
        if (file === undefined || typeof file === "string") {
            throw new Error("The GLB fixture exporter did not produce a binary fixture.");
        }

        return {
            bytes: new Uint8Array(await file.arrayBuffer()),
            structure: GLB_FIXTURE_STRUCTURE,
        };
    } finally {
        scene.dispose();
        engine.dispose();
    }
}

export async function readGlbStructureAsync(bytes: Uint8Array): Promise<SceneStructure> {
    registerBuiltInLoaders();

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
                vertexCount: mesh.getTotalVertices(),
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}

function toTuple3(x: number, y: number, z: number): [number, number, number] {
    return [x, y, z];
}

function toTuple4(x: number, y: number, z: number, w: number): [number, number, number, number] {
    return [x, y, z, w];
}
