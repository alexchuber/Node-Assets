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

            state._throwIfDisposed();
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

            await importGlbIntoSceneAsync(ImportMeshAsync, SceneLoader, bytes, scene, fileName, state._abortSignal);
            state._throwIfDisposed();
            assetContainer.moveAllFromScene();
            assetContainer.addAllToScene();
            this.writeOutput(this.output, sceneAsset);
        } catch (error) {
            state._throwIfDisposed();
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

interface BuildCancellation {
    readonly promise: Promise<never>;
    readonly aborted: boolean;
    readonly reason: unknown;
    onAbort(callback: (reason: unknown) => void): () => void;
    dispose(): void;
}

async function importGlbIntoSceneAsync(
    importMeshAsync: typeof SceneLoaderTypes.ImportMeshAsync,
    sceneLoader: typeof SceneLoaderTypes.SceneLoader,
    bytes: Uint8Array,
    scene: Scene,
    fileName: string,
    signal: AbortSignal
): Promise<void> {
    const cancellation = createBuildCancellation(signal);
    try {
        const capture = await withLoaderActivationLockAsync(() => captureLoaderLifecycleAsync(importMeshAsync, sceneLoader, bytes, scene, fileName, cancellation), cancellation);
        try {
            await Promise.race([Promise.all([capture.readyPromise, capture.completion.promise]), cancellation.promise]);
        } finally {
            capture.dispose();
        }
    } finally {
        cancellation.dispose();
    }
}

async function withLoaderActivationLockAsync<T>(operation: () => Promise<T>, cancellation: BuildCancellation): Promise<T> {
    const previous = loaderActivationTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    loaderActivationTail = previous.then(() => current);

    try {
        await Promise.race([previous, cancellation.promise]);
        throwIfBuildAborted(cancellation);
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
    fileName: string,
    cancellation: BuildCancellation
): Promise<LoaderCapture> {
    throwIfBuildAborted(cancellation);

    let activationObserver: IObserver | undefined;
    let completion: CompletionWait | undefined;
    let activationCaptured = false;
    let cancelled = false;
    let removeCancellationListener = (): void => {};
    let resolveActivation!: (value: CompletionWait) => void;
    let rejectActivation!: (reason: unknown) => void;
    const activationPromise = new Promise<CompletionWait>((resolve, reject) => {
        resolveActivation = resolve;
        rejectActivation = reject;
    });
    void activationPromise.then(undefined, () => undefined);
    const removeActivationObserver = (): void => {
        const observer = activationObserver;
        activationObserver = undefined;
        observer?.remove();
    };
    const cancel = (reason: unknown): void => {
        if (cancelled) {
            return;
        }

        cancelled = true;
        removeActivationObserver();
        completion?.dispose();
        rejectActivation(reason);
    };
    const onPluginActivated = (plugin: SceneLoaderPlugin): void => {
        if (cancelled || cancellation.aborted || activationCaptured || !isGlbPlugin(plugin)) {
            return;
        }

        activationCaptured = true;
        try {
            if (!hasLoaderLifecycle(plugin)) {
                throw new Error("The public GLB loader does not expose completion and error observables.");
            }

            completion = waitForLoaderCompletion(plugin, cancellation);
            if (cancelled || cancellation.aborted) {
                completion.dispose();
                return;
            }
            removeActivationObserver();
            removeCancellationListener();
            resolveActivation(completion);
        } catch (error) {
            removeActivationObserver();
            completion?.dispose();
            removeCancellationListener();
            rejectActivation(cancellation.aborted ? cancellation.reason : error);
        }
    };

    removeCancellationListener = cancellation.onAbort(cancel);
    throwIfBuildAborted(cancellation);
    activationObserver = sceneLoader.OnPluginActivatedObservable.add(onPluginActivated);
    if (cancellation.aborted) {
        removeActivationObserver();
        throw cancellation.reason;
    }

    let readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>;
    try {
        throwIfBuildAborted(cancellation);
        readyPromise = importMeshAsync(bytes, scene, {
            name: fileName,
            pluginExtension: ".glb",
            pluginOptions: {
                gltf: {
                    // NullEngine cannot provide texture pixels for Babylon's spec-gloss-to-metallic conversion; disabling this optional extension uses the asset's standard metallic-roughness fallback.
                    extensionOptions: {
                        KHR_materials_pbrSpecularGlossiness: {
                            enabled: false,
                        },
                    },
                },
            },
        });
    } catch (error) {
        removeActivationObserver();
        completion?.dispose();
        removeCancellationListener();
        throw cancellation.aborted ? cancellation.reason : error;
    }

    const readyRejection = readyPromise.then(
        () => new Promise<never>(() => {}),
        (error) => {
            if (cancelled || cancellation.aborted) {
                throw error;
            }

            removeActivationObserver();
            removeCancellationListener();
            rejectActivation(error);
            throw error;
        }
    );

    try {
        const capturedCompletion = await Promise.race([activationPromise, readyRejection, cancellation.promise]);
        if (cancellation.aborted || cancelled) {
            capturedCompletion.dispose();
            throw cancellation.reason;
        }

        let disposed = false;
        return {
            readyPromise,
            completion: capturedCompletion,
            dispose: () => {
                if (disposed) {
                    return;
                }

                disposed = true;
                removeActivationObserver();
                removeCancellationListener();
                capturedCompletion.dispose();
            },
        };
    } catch (error) {
        removeActivationObserver();
        completion?.dispose();
        removeCancellationListener();
        throw cancellation.aborted ? cancellation.reason : error;
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

function waitForLoaderCompletion(plugin: LoaderWithLifecycle, cancellation: BuildCancellation): CompletionWait {
    throwIfBuildAborted(cancellation);

    let resolveCompletion!: () => void;
    let rejectCompletion!: (reason: unknown) => void;
    let completeObserver: IObserver | undefined;
    let errorObserver: IObserver | undefined;
    let disposed = false;
    let settled = false;
    const promise = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });
    // Cancellation can reject this wait before capture hands it to its caller.
    void promise.then(undefined, () => undefined);
    let removeCancellationListener = (): void => {};
    const removeObservers = (): void => {
        const complete = completeObserver;
        completeObserver = undefined;
        const error = errorObserver;
        errorObserver = undefined;
        try {
            error?.remove();
        } finally {
            complete?.remove();
        }
    };
    const rejectForAbort = (reason: unknown): void => {
        if (disposed) {
            return;
        }

        disposed = true;
        settled = true;
        removeObservers();
        removeCancellationListener();
        rejectCompletion(reason);
    };
    removeCancellationListener = cancellation.onAbort(rejectForAbort);

    try {
        const complete = plugin.onCompleteObservable.addOnce(() => {
            if (settled || disposed) {
                return;
            }

            settled = true;
            resolveCompletion();
        });
        if (settled || disposed) {
            complete.remove();
        } else {
            completeObserver = complete;
        }

        const error = plugin.onErrorObservable.addOnce((reason) => {
            if (settled || disposed) {
                return;
            }

            settled = true;
            rejectCompletion(reason);
        });
        if (settled || disposed) {
            error.remove();
        } else {
            errorObserver = error;
        }
    } catch (error) {
        settled = true;
        removeCancellationListener();
        removeObservers();
        throw error;
    }

    return {
        promise,
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;
            settled = true;
            removeCancellationListener();
            removeObservers();
        },
    };
}

function createBuildCancellation(signal: AbortSignal): BuildCancellation {
    let aborted = false;
    let reason: unknown;
    let rejectAbort!: (reason: unknown) => void;
    const listeners = new Set<(reason: unknown) => void>();
    const promise = new Promise<never>((_, reject) => {
        rejectAbort = reject;
    });
    const abort = (): void => {
        if (aborted) {
            return;
        }

        aborted = true;
        reason = signal.reason ?? new Error("GLB import was aborted.");
        rejectAbort(reason);
        try {
            for (const listener of listeners) {
                listener(reason);
            }
        } finally {
            listeners.clear();
        }
    };

    if (signal.aborted) {
        abort();
    } else {
        signal.addEventListener("abort", abort, { once: true });
    }

    return {
        promise,
        get aborted() {
            return aborted;
        },
        get reason() {
            return reason;
        },
        onAbort: (callback) => {
            if (aborted) {
                callback(reason);
                return () => {};
            }

            listeners.add(callback);
            if (signal.aborted) {
                listeners.delete(callback);
                abort();
            }

            return () => {
                listeners.delete(callback);
            };
        },
        dispose: () => {
            signal.removeEventListener("abort", abort);
            listeners.clear();
        },
    };
}

function throwIfBuildAborted(cancellation: BuildCancellation): void {
    if (cancellation.aborted) {
        throw cancellation.reason;
    }
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
