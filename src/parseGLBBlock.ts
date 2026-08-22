import { type ConnectionPoint } from "./connectionPoint";
import { getNodeAssetBlockBuildState, NodeAssetBlock } from "./nodeAssetBlock";
import { SceneAsset } from "./sceneAsset";

let builtInLoadersRegistration: Promise<void> | undefined;

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

        try {
            await registerBuiltInLoadersAsync();
            const [{ AssetContainer }, { ImportMeshAsync }, { Scene }] = await Promise.all([
                import("@babylonjs/core/assetContainer.js"),
                import("@babylonjs/core/Loading/sceneLoader.js"),
                import("@babylonjs/core/scene.js"),
            ]);

            const scene = new Scene(state._engine);
            const sceneAsset = SceneAsset._create(scene);
            state._trackSceneAsset(sceneAsset);
            class OwnedAssetContainer extends AssetContainer {
                #disposed = false;

                public override dispose(): void {
                    if (this.#disposed) {
                        return;
                    }

                    this.#disposed = true;
                    try {
                        this.removeAllFromScene();
                        const meshGeometries = new Set(
                            this.meshes.flatMap((mesh) => {
                                const geometry = mesh.geometry;
                                return geometry === null ? [] : [geometry];
                            })
                        );
                        for (const geometry of this.geometries) {
                            if (!meshGeometries.has(geometry)) {
                                geometry.dispose();
                            }
                        }
                        this.geometries.length = 0;
                        for (const mesh of this.meshes) {
                            mesh.setParent(null);
                        }
                        for (const transformNode of this.transformNodes) {
                            transformNode.setParent(null);
                        }
                    } finally {
                        super.dispose();
                    }
                }
            }

            const assetContainer = new OwnedAssetContainer(scene);
            sceneAsset._attachAssetContainer(assetContainer);
            const fileName = `${this.name}.glb`;

            // Keep partial imports in the build-scoped scene until the public helper succeeds.
            await ImportMeshAsync(bytes, scene, {
                name: fileName,
                pluginExtension: ".glb",
            });
            assetContainer.moveAllFromScene();
            assetContainer.addAllToScene();
            this.writeOutput(this.output, sceneAsset);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Parse GLB block "${this.name}" failed: ${message}`, { cause: error });
        }
    }
}

function registerBuiltInLoadersAsync(): Promise<void> {
    const registration = builtInLoadersRegistration;
    if (registration !== undefined) {
        return registration;
    }

    const nextRegistration = import("@babylonjs/loaders/dynamic.js").then(({ registerBuiltInLoaders }) => {
        registerBuiltInLoaders();
    });
    builtInLoadersRegistration = nextRegistration;
    return nextRegistration;
}
