import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";

export interface SceneStructure {
    readonly meshes: readonly MeshStructure[];
    readonly materials: readonly string[];
}

export interface MeshStructure {
    readonly materialName: string | null;
    readonly name: string;
    readonly vertexCount: number;
}

export interface GlbFixture {
    readonly bytes: Uint8Array;
    readonly structure: SceneStructure;
}

export async function createGlbFixtureAsync(): Promise<GlbFixture> {
    const engine = new NullEngine();
    const scene = new Scene(engine);

    try {
        const box = MeshBuilder.CreateBox("fixture-box", { size: 2 }, scene);
        const material = new StandardMaterial("fixture-material", scene);
        material.diffuseColor = new Color3(0.2, 0.4, 0.6);
        box.material = material;

        const data = await GLTF2Export.GLBAsync(scene, "fixture.glb");
        const file = data.files["fixture.glb"];
        if (file === undefined || typeof file === "string") {
            throw new Error("The GLB fixture exporter did not produce a binary fixture.");
        }

        return {
            bytes: new Uint8Array(await file.arrayBuffer()),
            structure: readSceneStructure(scene),
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
        materials: scene.materials.map((material) => material.name).sort(),
        meshes: scene.meshes
            .filter((mesh) => mesh.getTotalVertices() > 0)
            .map((mesh) => ({
                materialName: mesh.material?.name ?? null,
                name: mesh.name,
                vertexCount: mesh.getTotalVertices(),
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
    };
}
