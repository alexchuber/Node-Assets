import { type ConnectionPoint } from "./connectionPoint";
import { getNodeAssetBlockBuildState, NodeAssetBlock } from "./nodeAssetBlock";
import { SceneAsset } from "./sceneAsset";
import type { IObserver } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type * as SceneLoaderTypes from "@babylonjs/core/Loading/sceneLoader.js";

let builtInLoadersRegistration: Promise<void> | undefined;
let sceneLoaderModule: Promise<typeof SceneLoaderTypes> | undefined;
// SceneLoader activation is global, so serialize only each plugin capture window.
let loaderActivationTail = Promise.resolve();

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
    const capture = await withLoaderActivationLockAsync(() => captureLoaderLifecycleAsync(importMeshAsync, sceneLoader, bytes, scene, fileName));
    try {
        await Promise.all([capture.readyPromise, capture.completion.promise]);
    } finally {
        capture.dispose();
    }
}

async function withLoaderActivationLockAsync<T>(operation: () => Promise<T>): Promise<T> {
    const previous = loaderActivationTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    loaderActivationTail = previous.then(() => current);
    await previous;

    try {
        return await operation();
    } finally {
        release();
    }
}

interface LoaderCapture {
    readonly readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>;
    readonly completion: CompletionWait;
    dispose(): void;
}

async function captureLoaderLifecycleAsync(
    importMeshAsync: typeof SceneLoaderTypes.ImportMeshAsync,
    sceneLoader: typeof SceneLoaderTypes.SceneLoader,
    bytes: Uint8Array,
    scene: Scene,
    fileName: string
): Promise<LoaderCapture> {
    let activationObserver: IObserver | undefined;
    let completion: CompletionWait | undefined;
    let activationCaptured = false;
    let resolveActivation!: (value: CompletionWait) => void;
    let rejectActivation!: (reason: unknown) => void;
    const activationPromise = new Promise<CompletionWait>((resolve, reject) => {
        resolveActivation = resolve;
        rejectActivation = reject;
    });
    const removeActivationObserver = (): void => {
        const observer = activationObserver;
        activationObserver = undefined;
        observer?.remove();
    };
    const onPluginActivated = (plugin: SceneLoaderPlugin): void => {
        if (activationCaptured || !isGlbPlugin(plugin)) {
            return;
        }

        activationCaptured = true;
        try {
            if (!hasLoaderLifecycle(plugin)) {
                throw new Error("The public GLB loader does not expose completion and error observables.");
            }

            completion = waitForLoaderCompletion(plugin);
            removeActivationObserver();
            resolveActivation(completion);
        } catch (error) {
            removeActivationObserver();
            completion?.dispose();
            rejectActivation(error);
        }
    };

    activationObserver = sceneLoader.OnPluginActivatedObservable.add(onPluginActivated);
    if (activationCaptured) {
        removeActivationObserver();
    }

    let readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>;
    try {
        readyPromise = importMeshAsync(bytes, scene, {
            name: fileName,
            pluginExtension: ".glb",
        });
    } catch (error) {
        removeActivationObserver();
        rejectActivation(error);
        throw error;
    }
    if (activationCaptured) {
        removeActivationObserver();
    }

    const readyRejection = readyPromise.then(
        () => new Promise<never>(() => {}),
        (error) => {
            removeActivationObserver();
            rejectActivation(error);
            throw error;
        }
    );

    try {
        const capturedCompletion = await Promise.race([activationPromise, readyRejection]);
        return {
            readyPromise,
            completion: capturedCompletion,
            dispose: () => {
                removeActivationObserver();
                capturedCompletion.dispose();
            },
        };
    } catch (error) {
        removeActivationObserver();
        completion?.dispose();
        throw error;
    }
}

function isGlbPlugin(plugin: SceneLoaderPlugin): boolean {
    return typeof plugin.name === "string" && plugin.name.toLowerCase() === "gltf";
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
    let completeObserver: IObserver | undefined;
    let errorObserver: IObserver | undefined;
    const promise = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });
    try {
        completeObserver = plugin.onCompleteObservable.addOnce(() => {
            resolveCompletion();
        });
        errorObserver = plugin.onErrorObservable.addOnce((reason) => {
            rejectCompletion(reason);
        });
    } catch (error) {
        try {
            errorObserver?.remove();
        } finally {
            completeObserver?.remove();
        }
        throw error;
    }

    let disposed = false;
    return {
        promise,
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;
            try {
                errorObserver?.remove();
            } finally {
                completeObserver?.remove();
            }
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
