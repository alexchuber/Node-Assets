import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MorphTargetManager } from "@babylonjs/core/Morph/morphTargetManager.js";
import { GLTFLoader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { GLTFFileLoader, type IGLTFLoaderData } from "@babylonjs/loaders/glTF/glTFFileLoader.pure.js";
import { type ConnectionPoint } from "./connectionPoint";
import { getNodeAssetBlockBuildState, NodeAssetBlock } from "./nodeAssetBlock";
import { SceneAsset } from "./sceneAsset";

let gltfLoaderRegistered = false;

class OwnedAssetContainer extends AssetContainer {
    private _disposed = false;

    public override dispose(): void {
        // Babylon's scene observer may dispose an unattached container during scene cleanup.
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        super.dispose();
    }
}

export class ParseGLBBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"File", "input">;
    public readonly output: ConnectionPoint<"SceneAsset", "output">;

    public constructor(name: string) {
        super(name);
        this.input = this.registerInput("input", "File");
        this.output = this.registerOutput("output", "SceneAsset");
    }

    protected override async _buildAsync(): Promise<void> {
        const bytes = await this.readInputAsync(this.input);
        const state = getNodeAssetBlockBuildState(this);
        if (!gltfLoaderRegistered) {
            registerBuiltInLoaders();
            gltfLoaderRegistered = true;
        }

        const scene = new Scene(state._engine);
        const sceneAsset = SceneAsset._create(scene);
        state._trackSceneAsset(sceneAsset);
        const assetContainer = new OwnedAssetContainer(scene);
        sceneAsset._attachAssetContainer(assetContainer);
        const fileLoader = new GLTFFileLoader();
        let gltfLoader: GLTFLoader | undefined;

        try {
            const data = await loadGLTFDataAsync(fileLoader, scene, bytes, `${this.name}.glb`);
            gltfLoader = new GLTFLoader(fileLoader);
            const materials: Material[] = [];
            fileLoader.onMaterialLoadedObservable.add((material) => {
                materials.push(material);
            });
            const textures: BaseTexture[] = [];
            fileLoader.onTextureLoadedObservable.add((texture) => {
                textures.push(texture);
            });
            const cameras: Camera[] = [];
            fileLoader.onCameraLoadedObservable.add((camera) => {
                cameras.push(camera);
            });
            const morphTargetManagers: MorphTargetManager[] = [];
            fileLoader.onMeshLoadedObservable.add((mesh: AbstractMesh) => {
                if (mesh.morphTargetManager) {
                    morphTargetManagers.push(mesh.morphTargetManager);
                }
            });

            // The low-level loader accepts our container before import can reject.
            const result = await gltfLoader.importMeshAsync(null, scene, assetContainer, data, "", undefined, `${this.name}.glb`);
            await fileLoader.whenCompleteAsync();
            assetContainer.geometries.push(...result.geometries);
            assetContainer.meshes.push(...result.meshes);
            assetContainer.particleSystems.push(...result.particleSystems);
            assetContainer.skeletons.push(...result.skeletons);
            assetContainer.animationGroups.push(...result.animationGroups);
            assetContainer.materials.push(...materials);
            assetContainer.textures.push(...textures);
            assetContainer.lights.push(...result.lights);
            assetContainer.transformNodes.push(...result.transformNodes);
            assetContainer.cameras.push(...cameras);
            assetContainer.morphTargetManagers.push(...morphTargetManagers);
            assetContainer.addAllToScene();
            this.writeOutput(this.output, sceneAsset);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Parse GLB block "${this.name}" failed: ${message}`, { cause: error });
        } finally {
            try {
                gltfLoader?.dispose();
            } finally {
                fileLoader.dispose();
            }
        }
    }
}

function loadGLTFDataAsync(fileLoader: GLTFFileLoader, scene: Scene, bytes: Uint8Array, fileName: string): Promise<IGLTFLoaderData> {
    return new Promise<IGLTFLoaderData>((resolve, reject) => {
        fileLoader.loadFile(
            scene,
            bytes,
            "",
            (data) => {
                if (!isGLTFLoaderData(data)) {
                    reject(new Error("GLB loader returned invalid parsed data."));
                    return;
                }

                resolve(data);
            },
            undefined,
            true,
            (_request, exception) => {
                reject(exception ?? new Error("GLB loader failed to parse input."));
            },
            fileName
        );
    });
}

function isGLTFLoaderData(data: unknown): data is IGLTFLoaderData {
    if (typeof data !== "object" || data === null) {
        return false;
    }

    return "json" in data && typeof data.json === "object" && data.json !== null && "bin" in data;
}
