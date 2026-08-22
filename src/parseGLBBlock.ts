import { type ConnectionPoint } from "./connectionPoint";
import { getNodeAssetBlockBuildState, NodeAssetBlock } from "./nodeAssetBlock";
import { SceneAsset } from "./sceneAsset";
import type { IObserver } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type * as SceneLoaderTypes from "@babylonjs/core/Loading/sceneLoader.js";

let builtInLoadersRegistration: Promise<void> | undefined;
let sceneLoaderModule: Promise<typeof SceneLoaderTypes> | undefined;

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
            const [{ AssetContainer }, { ImportMeshAsync, SceneLoader }, { Scene }] = await Promise.all([
                import("@babylonjs/core/assetContainer.js"),
                loadSceneLoaderAsync(),
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

            await importGlbIntoSceneAsync(ImportMeshAsync, SceneLoader, bytes, scene, fileName);
            assetContainer.moveAllFromScene();
            assetContainer.addAllToScene();
            this.writeOutput(this.output, sceneAsset);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Parse GLB block "${this.name}" failed: ${message}`, { cause: error });
        }
    }
}

type SceneLoaderPlugin = SceneLoaderTypes.ISceneLoaderPlugin | SceneLoaderTypes.ISceneLoaderPluginAsync;

interface PublicObservable {
    addOnce(callback: (eventData: unknown) => void): IObserver;
}

type LoaderWithLifecycle = SceneLoaderPlugin & {
    readonly onCompleteObservable: PublicObservable;
    readonly onErrorObservable: PublicObservable;
};

interface CompletionWait {
    readonly promise: Promise<void>;
    dispose(): void;
}

async function importGlbIntoSceneAsync(
    importMeshAsync: typeof SceneLoaderTypes.ImportMeshAsync,
    sceneLoader: typeof SceneLoaderTypes.SceneLoader,
    bytes: Uint8Array,
    scene: Scene,
    fileName: string
): Promise<void> {
    let activatedPlugin: SceneLoaderPlugin | undefined;
    const activationObserver = sceneLoader.OnPluginActivatedObservable.addOnce((plugin) => {
        activatedPlugin = plugin;
    });

    let readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>;
    try {
        readyPromise = importMeshAsync(bytes, scene, {
            name: fileName,
            pluginExtension: ".glb",
        });
    } finally {
        activationObserver.remove();
    }

    if (activatedPlugin === undefined) {
        await rejectUnsupportedLifecycleAsync(readyPromise, "The public GLB loader did not activate synchronously.");
        return;
    }
    const plugin = activatedPlugin;
    if (!hasLoaderLifecycle(plugin)) {
        await rejectUnsupportedLifecycleAsync(readyPromise, "The public GLB loader does not expose completion and error observables.");
        return;
    }

    const completion = waitForLoaderCompletion(plugin);
    try {
        await Promise.all([readyPromise, completion.promise]);
    } finally {
        completion.dispose();
    }
}

async function rejectUnsupportedLifecycleAsync(readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>, reason: string): Promise<never> {
    try {
        await readyPromise;
    } catch (error) {
        throw new Error(reason, { cause: error });
    }

    throw new Error(reason);
}

function hasLoaderLifecycle(plugin: SceneLoaderPlugin): plugin is LoaderWithLifecycle {
    return "onCompleteObservable" in plugin && isPublicObservable(plugin.onCompleteObservable) && "onErrorObservable" in plugin && isPublicObservable(plugin.onErrorObservable);
}

function isPublicObservable(value: unknown): value is PublicObservable {
    return typeof value === "object" && value !== null && "addOnce" in value && typeof value.addOnce === "function";
}

function waitForLoaderCompletion(plugin: LoaderWithLifecycle): CompletionWait {
    let resolveCompletion!: () => void;
    let rejectCompletion!: (reason: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });
    const completeObserver = plugin.onCompleteObservable.addOnce(() => {
        resolveCompletion();
    });
    const errorObserver = plugin.onErrorObservable.addOnce((reason) => {
        rejectCompletion(reason);
    });

    return {
        promise,
        dispose: () => {
            completeObserver.remove();
            errorObserver.remove();
        },
    };
}

function registerBuiltInLoadersAsync(): Promise<void> {
    const registration = builtInLoadersRegistration;
    if (registration !== undefined) {
        return registration;
    }

    const nextRegistration = import("@babylonjs/loaders/dynamic.js")
        .then(({ registerBuiltInLoaders }) => {
            registerBuiltInLoaders();
            return import("@babylonjs/loaders/glTF/2.0/glTFLoader.js");
        })
        .then(() => undefined);
    builtInLoadersRegistration = nextRegistration;
    return nextRegistration;
}

function loadSceneLoaderAsync(): Promise<typeof SceneLoaderTypes> {
    const module = sceneLoaderModule;
    if (module !== undefined) {
        return module;
    }

    const nextModule = import("@babylonjs/core/Loading/sceneLoader.js");
    sceneLoaderModule = nextModule;
    return nextModule;
}
