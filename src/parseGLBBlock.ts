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
            const rootUrl = state._getFileRootUrl(bytes) ?? "";

            await importGlbIntoSceneAsync(ImportMeshAsync, SceneLoader, bytes, rootUrl, state._abortSignal, scene, fileName);
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
type LoaderCorrelationMarker = (loaderData: unknown) => void;

interface PublicObservable {
    addOnce(callback: (eventData: unknown) => void): IObserver;
}

interface PublicObservableWithObservers extends PublicObservable {
    readonly observers: readonly PublicObservableObserver[];
}

interface PublicObservableObserver {
    readonly callback: (...args: never[]) => unknown;
}

type LoaderWithLifecycle = SceneLoaderPlugin & {
    readonly onCompleteObservable: PublicObservable;
    readonly onErrorObservable: PublicObservable;
};

type LoaderWithCorrelation = LoaderWithLifecycle & {
    readonly onParsedObservable: PublicObservableWithObservers;
};

interface CompletionWait {
    readonly promise: Promise<void>;
    dispose(): void;
}

interface CancellationWait {
    readonly promise: Promise<never>;
    dispose(): void;
}

async function importGlbIntoSceneAsync(
    importMeshAsync: typeof SceneLoaderTypes.ImportMeshAsync,
    sceneLoader: typeof SceneLoaderTypes.SceneLoader,
    bytes: Uint8Array,
    rootUrl: string,
    abortSignal: AbortSignal,
    scene: Scene,
    fileName: string
): Promise<void> {
    const correlationMarker: LoaderCorrelationMarker = () => undefined;
    const capture = await captureLoaderLifecycleAsync(importMeshAsync, sceneLoader, bytes, rootUrl, abortSignal, scene, fileName, correlationMarker);
    const readyWait = waitForAbort(abortSignal);
    const readyFailure = capture.readyPromise.then(
        () => new Promise<never>(() => undefined),
        (error: unknown) => {
            throw error;
        }
    );
    try {
        await Promise.race([capture.completion.promise, readyFailure, readyWait.promise]);
    } finally {
        readyWait.dispose();
        capture.dispose();
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
    rootUrl: string,
    abortSignal: AbortSignal,
    scene: Scene,
    fileName: string,
    correlationMarker: LoaderCorrelationMarker
): Promise<LoaderCapture> {
    let activationObserver: IObserver | undefined;
    let completion: CompletionWait | undefined;
    let activationCaptured = false;
    let cancelled = false;
    let abortObserverInstalled = false;
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
    const removeAbortObserver = (): void => {
        if (!abortObserverInstalled) {
            return;
        }

        abortObserverInstalled = false;
        abortSignal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
        if (cancelled) {
            return;
        }

        cancelled = true;
        removeActivationObserver();
        completion?.dispose();
        rejectActivation(getAbortReason(abortSignal));
        removeAbortObserver();
    };
    const onPluginActivated = (plugin: SceneLoaderPlugin): void => {
        if (activationCaptured || cancelled || abortSignal.aborted || !isGlbPlugin(plugin) || !hasLoaderCorrelationMarker(plugin, correlationMarker)) {
            return;
        }

        activationCaptured = true;
        try {
            if (!hasLoaderLifecycle(plugin)) {
                throw new Error("The public GLB loader does not expose completion and error observables.");
            }

            completion = waitForLoaderCompletion(plugin, abortSignal);
            removeActivationObserver();
            removeAbortObserver();
            resolveActivation(completion);
        } catch (error) {
            removeActivationObserver();
            completion?.dispose();
            removeAbortObserver();
            rejectActivation(error);
        }
    };

    throwIfAborted(abortSignal);
    try {
        activationObserver = sceneLoader.OnPluginActivatedObservable.add(onPluginActivated);
        if (abortSignal.aborted) {
            onAbort();
        }
        if (!cancelled) {
            abortSignal.addEventListener("abort", onAbort, { once: true });
            abortObserverInstalled = true;
            if (abortSignal.aborted) {
                onAbort();
            }
        }
        throwIfAborted(abortSignal);
    } catch (error) {
        removeActivationObserver();
        completion?.dispose();
        removeAbortObserver();
        rejectActivation(error);
        throw error;
    }

    let readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>;
    try {
        readyPromise = importMeshAsync(bytes, scene, {
            name: fileName,
            pluginExtension: ".glb",
            pluginOptions: {
                gltf: {
                    onParsed: correlationMarker,
                    preprocessUrlAsync: (url: string) => preprocessGlbUrlAsync(rootUrl, url),
                    // NullEngine cannot provide texture pixels for Babylon's spec-gloss-to-metallic conversion; disabling this optional extension uses the asset's standard metallic-roughness fallback.
                    extensionOptions: {
                        KHR_materials_pbrSpecularGlossiness: {
                            enabled: false,
                        },
                    },
                },
            },
            rootUrl,
        });
    } catch (error) {
        removeActivationObserver();
        completion?.dispose();
        removeAbortObserver();
        if (abortSignal.aborted) {
            throw getAbortReason(abortSignal);
        }
        rejectActivation(error);
        throw error;
    }
    if (activationCaptured) {
        removeActivationObserver();
        removeAbortObserver();
    }

    const abortWait = waitForAbort(abortSignal);
    const activationOutcome = activationPromise.then(() => "activated" as const);
    const readyOutcome = readyPromise.then(
        () => "ready" as const,
        (error) => {
            removeActivationObserver();
            removeAbortObserver();
            rejectActivation(error);
            throw error;
        }
    );

    try {
        const captureOutcome = await Promise.race([activationOutcome, readyOutcome, abortWait.promise]);
        throwIfAborted(abortSignal);
        if (captureOutcome === "ready") {
            removeActivationObserver();
            throw new Error("The public GLB loader did not preserve the per-call activation marker.");
        }

        const capturedCompletion = await activationPromise;
        abortWait.dispose();
        return {
            readyPromise,
            completion: capturedCompletion,
            dispose: () => {
                abortWait.dispose();
                removeActivationObserver();
                removeAbortObserver();
                capturedCompletion.dispose();
            },
        };
    } catch (error) {
        abortWait.dispose();
        removeActivationObserver();
        removeAbortObserver();
        completion?.dispose();
        rejectActivation(error);
        throw error;
    }
}

function isGlbPlugin(plugin: SceneLoaderPlugin): boolean {
    return typeof plugin.name === "string" && plugin.name.toLowerCase() === "gltf";
}

function hasLoaderLifecycle(plugin: SceneLoaderPlugin): plugin is LoaderWithLifecycle {
    return "onCompleteObservable" in plugin && isPublicObservable(plugin.onCompleteObservable) && "onErrorObservable" in plugin && isPublicObservable(plugin.onErrorObservable);
}

function hasLoaderCorrelationMarker(plugin: SceneLoaderPlugin, correlationMarker: LoaderCorrelationMarker): plugin is LoaderWithCorrelation {
    if (!("onParsedObservable" in plugin) || !isPublicObservableWithObservers(plugin.onParsedObservable)) {
        return false;
    }

    return plugin.onParsedObservable.observers.some((observer) => observer.callback === correlationMarker);
}

function isPublicObservable(value: unknown): value is PublicObservable {
    return typeof value === "object" && value !== null && "addOnce" in value && typeof value.addOnce === "function";
}

function isPublicObservableWithObservers(value: unknown): value is PublicObservableWithObservers {
    if (!isPublicObservable(value)) {
        return false;
    }

    const observers = (value as PublicObservable & { readonly observers?: unknown }).observers;
    if (!Array.isArray(observers)) {
        return false;
    }

    return observers.every((observer: unknown) => {
        const callback = typeof observer === "object" && observer !== null ? (observer as { readonly callback?: unknown }).callback : undefined;
        return typeof callback === "function";
    });
}

function waitForLoaderCompletion(plugin: LoaderWithLifecycle, abortSignal: AbortSignal): CompletionWait {
    let resolveCompletion!: () => void;
    let rejectCompletion!: (reason: unknown) => void;
    let completeObserver: IObserver | undefined;
    let errorObserver: IObserver | undefined;
    let disposed = false;
    const removeLifecycleObservers = (): void => {
        try {
            errorObserver?.remove();
        } finally {
            completeObserver?.remove();
        }
    };
    const onAbort = (): void => {
        if (disposed) {
            return;
        }

        disposed = true;
        try {
            removeLifecycleObservers();
        } finally {
            abortSignal.removeEventListener("abort", onAbort);
        }
        rejectCompletion(getAbortReason(abortSignal));
    };
    const promise = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });
    try {
        completeObserver = plugin.onCompleteObservable.addOnce(() => {
            if (!disposed) {
                resolveCompletion();
            }
        });
        errorObserver = plugin.onErrorObservable.addOnce((reason) => {
            if (!disposed) {
                rejectCompletion(reason);
            }
        });
        if (abortSignal.aborted) {
            onAbort();
        } else {
            abortSignal.addEventListener("abort", onAbort, { once: true });
            if (abortSignal.aborted) {
                onAbort();
            }
        }
    } catch (error) {
        try {
            removeLifecycleObservers();
        } finally {
            abortSignal.removeEventListener("abort", onAbort);
        }
        throw error;
    }

    return {
        promise,
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;
            try {
                removeLifecycleObservers();
            } finally {
                abortSignal.removeEventListener("abort", onAbort);
            }
        },
    };
}

function waitForAbort(abortSignal: AbortSignal): CancellationWait {
    let disposed = false;
    let rejectCancellation!: (reason: unknown) => void;
    const onAbort = (): void => {
        if (!disposed) {
            rejectCancellation(getAbortReason(abortSignal));
        }
    };
    const promise = new Promise<never>((_, reject) => {
        rejectCancellation = reject;
    });
    if (abortSignal.aborted) {
        onAbort();
    } else {
        abortSignal.addEventListener("abort", onAbort, { once: true });
        if (abortSignal.aborted) {
            onAbort();
        }
    }

    return {
        promise,
        dispose: () => {
            if (disposed) {
                return;
            }

            disposed = true;
            abortSignal.removeEventListener("abort", onAbort);
        },
    };
}

function throwIfAborted(abortSignal: AbortSignal): void {
    if (abortSignal.aborted) {
        throw getAbortReason(abortSignal);
    }
}

function getAbortReason(abortSignal: AbortSignal): unknown {
    return abortSignal.reason ?? new Error("The GLB load was aborted.");
}

function preprocessGlbUrlAsync(rootUrl: string, url: string): Promise<string> {
    if (rootUrl === "") {
        return Promise.resolve(url);
    }

    const reference = url.startsWith(rootUrl) ? url.slice(rootUrl.length) : url;
    if (reference.toLowerCase().startsWith("data:")) {
        return Promise.resolve(reference);
    }

    return Promise.resolve(new URL(reference, rootUrl).href);
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
