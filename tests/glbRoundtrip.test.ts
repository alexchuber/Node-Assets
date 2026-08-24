import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Geometry } from "@babylonjs/core/Meshes/geometry.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import { Scene } from "@babylonjs/core/scene.js";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";
import type { IObserver } from "@babylonjs/core/Misc/observable.js";
import type * as SceneLoaderTypes from "@babylonjs/core/Loading/sceneLoader.js";
import type { IGLTFLoaderData } from "@babylonjs/loaders/glTF/glTFFileLoader.pure.js";
import { describe, expect, it, vi } from "vitest";

import { InputBlock, NodeAsset, NodeAssetBlock, OutputBlock, ParseGLBBlock, SerializeGLBBlock, type InputSource } from "../src/index";
import { type ConnectionPoint } from "../src/connectionPoint";
import { getNodeAssetBlockBuildState } from "../src/nodeAssetBlock";
import { createGlbFixtureAsync, readGlbStructureAsync, readGlbStructureWithSwappedFirstTriangleAsync } from "./glbFixture";

type ImportMeshAsync = typeof SceneLoaderTypes.ImportMeshAsync;
type ImportMeshAsyncArguments = Parameters<ImportMeshAsync>;
type ImportMeshAsyncOverride = (...args: ImportMeshAsyncArguments) => ReturnType<ImportMeshAsync>;
type CorrelationMarker = (loaderData: IGLTFLoaderData) => void;
type UrlPreprocessor = (url: string) => Promise<string>;
type PublicLoaderPlugin = SceneLoaderTypes.ISceneLoaderPluginAsync & {
    readonly onCompleteObservable: PublicObservable<void>;
    readonly onErrorObservable: PublicObservable<unknown>;
    readonly onParsedObservable: PublicObservableWithObservers<IGLTFLoaderData>;
};

interface PublicObservable<T> {
    addOnce(callback: (eventData: T) => void): IObserver;
    readonly observers: readonly unknown[];
}

interface PublicObservableWithObservers<T> extends PublicObservable<T> {
    readonly observers: readonly PublicObservableObserver[];
}

interface PublicObservableObserver {
    readonly callback: (...args: never[]) => unknown;
}

class StateCapturingFileBlock extends NodeAssetBlock {
    public readonly output: ConnectionPoint<"File", "output">;
    public state: ReturnType<typeof getNodeAssetBlockBuildState> | undefined;

    public constructor(
        name: string,
        private readonly bytes: Uint8Array
    ) {
        super(name);
        this.output = this.registerOutput("output", "File");
    }

    protected override _buildAsync(): Promise<void> {
        this.state = getNodeAssetBlockBuildState(this);
        this.writeOutput(this.output, this.bytes);
        return Promise.resolve();
    }
}

interface LoaderControl {
    readonly plugin: PublicLoaderPlugin;
    readonly readyPromise: Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>;
    complete(): void;
    fail(reason: unknown): void;
    rejectReady(reason: unknown): void;
    resolveReady(): void;
}

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

    it("rejects SceneAsset fan-out before parsing or serializing", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const firstSerialize = new SerializeGLBBlock("first serialize");
        const secondSerialize = new SerializeGLBBlock("second serialize");
        const firstOutput = new OutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");
        const asset = new NodeAsset("graph");

        input.source = fixture.bytes;
        input.output.connectTo(parse.input);
        parse.output.connectTo(firstSerialize.input);
        parse.output.connectTo(secondSerialize.input);
        firstSerialize.output.connectTo(firstOutput.input);
        secondSerialize.output.connectTo(secondOutput.input);
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);

        publicImportCalls.length = 0;
        const serializeGlb = vi.spyOn(GLTF2Export, "GLBAsync");
        try {
            const error = await asset.buildAsync().catch((reason: unknown) => reason);
            expect(error).toBeInstanceOf(Error);
            if (!(error instanceof Error)) {
                return;
            }

            expect(error.message).toBe(
                'NodeAsset "graph" cannot build because the graph has structural errors:\n' +
                    'Block "parse" output "output" produces a SceneAsset value that is moved to its consumer and cannot feed multiple consumers in v0.'
            );
            expect(publicImportCalls).toHaveLength(0);
            expect(serializeGlb).not.toHaveBeenCalled();
            expect(() => firstOutput.data).toThrow('Output block "first.glb"');
            expect(() => secondOutput.data).toThrow('Output block "second.glb"');
        } finally {
            serializeGlb.mockRestore();
            publicImportCalls.length = 0;
            asset.dispose();
        }
    });

    it("aggregates missing inputs with SceneAsset fan-out without executing the graph", async () => {
        const parse = new ParseGLBBlock("parse");
        const firstSerialize = new SerializeGLBBlock("first serialize");
        const secondSerialize = new SerializeGLBBlock("second serialize");
        const firstOutput = new OutputBlock("first.glb");
        const secondOutput = new OutputBlock("second.glb");
        const asset = new NodeAsset("graph");

        parse.output.connectTo(firstSerialize.input);
        parse.output.connectTo(secondSerialize.input);
        firstSerialize.output.connectTo(firstOutput.input);
        secondSerialize.output.connectTo(secondOutput.input);
        asset.addOutputBlock(firstOutput);
        asset.addOutputBlock(secondOutput);

        publicImportCalls.length = 0;
        const serializeGlb = vi.spyOn(GLTF2Export, "GLBAsync");
        try {
            const error = await asset.buildAsync().catch((reason: unknown) => reason);
            expect(error).toBeInstanceOf(Error);
            if (!(error instanceof Error)) {
                return;
            }

            expect(error.message).toBe(
                'NodeAsset "graph" cannot build because the graph has structural errors:\n' +
                    'Block "parse" has an unconnected required input "input".\n' +
                    'Block "parse" output "output" produces a SceneAsset value that is moved to its consumer and cannot feed multiple consumers in v0.'
            );
            expect(publicImportCalls).toHaveLength(0);
            expect(serializeGlb).not.toHaveBeenCalled();
            expect(() => firstOutput.data).toThrow('Output block "first.glb"');
            expect(() => secondOutput.data).toThrow('Output block "second.glb"');
        } finally {
            serializeGlb.mockRestore();
            publicImportCalls.length = 0;
            asset.dispose();
        }
    });

    it("preserves a published output owned by another graph on fan-out validation failure", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const firstSerialize = new SerializeGLBBlock("first serialize");
        const secondSerialize = new SerializeGLBBlock("second serialize");
        const sharedOutput = new OutputBlock("shared.glb");
        const secondOutput = new OutputBlock("second.glb");
        const firstAsset = new NodeAsset("first graph");
        const secondAsset = new NodeAsset("second graph");

        input.source = fixture.bytes;
        input.output.connectTo(parse.input);
        parse.output.connectTo(firstSerialize.input);
        firstSerialize.output.connectTo(sharedOutput.input);
        firstAsset.addOutputBlock(sharedOutput);

        try {
            await firstAsset.buildAsync();
            const publishedData = sharedOutput.data;

            parse.output.connectTo(secondSerialize.input);
            secondSerialize.output.connectTo(secondOutput.input);
            secondAsset.addOutputBlock(sharedOutput);
            secondAsset.addOutputBlock(secondOutput);

            publicImportCalls.length = 0;
            const serializeGlb = vi.spyOn(GLTF2Export, "GLBAsync");
            try {
                await expect(secondAsset.buildAsync()).rejects.toThrow(
                    'Block "parse" output "output" produces a SceneAsset value that is moved to its consumer and cannot feed multiple consumers in v0.'
                );
                expect(publicImportCalls).toHaveLength(0);
                expect(serializeGlb).not.toHaveBeenCalled();
                expect(sharedOutput.data).toBe(publishedData);
                expect(() => secondOutput.data).toThrow('Output block "second.glb"');
            } finally {
                serializeGlb.mockRestore();
                publicImportCalls.length = 0;
            }
        } finally {
            secondAsset.dispose();
            firstAsset.dispose();
        }
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
                pluginOptions: {
                    gltf: {
                        extensionOptions: {
                            KHR_materials_pbrSpecularGlossiness: {
                                enabled: false,
                            },
                        },
                    },
                },
            });
        } finally {
            publicImportCalls.length = 0;
        }
    });

    it("captures a glTF plugin activated asynchronously", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        let importReturned = false;
        let activationWasAsynchronous = false;
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("async-factory", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            queueMicrotask(() => {
                activationWasAsynchronous = importReturned;
                SceneLoader.OnPluginActivatedObservable.notifyObservers({ ...control.plugin, name: "obj" });
                SceneLoader.OnPluginActivatedObservable.notifyObservers({ ...control.plugin, name: "GLTF" });
                control.resolveReady();
                queueMicrotask(() => control.complete());
            });
            importReturned = true;
            return control.readyPromise;
        };

        try {
            await expect(graph.asset.buildAsync()).resolves.toBeUndefined();
            expect(activationWasAsynchronous).toBe(true);
        } finally {
            publicImportOverride.current = undefined;
            graph.asset.dispose();
        }
    });

    it("cleans up activation observation when READY rejects before plugin activation", async () => {
        const fixture = await createGlbFixtureAsync();
        const failedGraph = createRoundtripGraph(fixture.bytes);
        const succeedingGraph = createRoundtripGraph(fixture.bytes);
        let rejectReady!: (reason: unknown) => void;
        let firstImportStarted!: () => void;
        const firstImportStartedPromise = new Promise<void>((resolve) => {
            firstImportStarted = resolve;
        });
        const firstReadyPromise = new Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>((_, reject) => {
            rejectReady = reject;
        });
        let importCount = 0;
        const activationObserverCount = SceneLoader.OnPluginActivatedObservable.observers.length;
        publicImportOverride.current = (_source, scene, options) => {
            importCount += 1;
            if (importCount === 1) {
                firstImportStarted();
                return firstReadyPromise;
            }

            const mesh = MeshBuilder.CreateBox("after-ready-rejection", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            queueMicrotask(() => {
                SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
                control.resolveReady();
                control.complete();
            });
            return control.readyPromise;
        };

        try {
            const failedBuild = failedGraph.asset.buildAsync();
            await firstImportStartedPromise;
            const succeedingBuild = succeedingGraph.asset.buildAsync();
            await Promise.resolve();
            expect(importCount).toBe(1);

            rejectReady(new Error("forced ready rejection before activation"));
            await expect(failedBuild).rejects.toThrow('Parse GLB block "parse" failed: forced ready rejection before activation');
            expect(SceneLoader.OnPluginActivatedObservable.observers).toHaveLength(activationObserverCount);
            await expect(succeedingBuild).resolves.toBeUndefined();
            expect(importCount).toBe(2);
        } finally {
            publicImportOverride.current = undefined;
            failedGraph.asset.dispose();
            succeedingGraph.asset.dispose();
        }
    });

    it("removes activation observation synchronously when aborted before plugin activation", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new StateCapturingFileBlock("source", fixture.bytes);
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        const activationObserverCount = SceneLoader.OnPluginActivatedObservable.observers.length;
        let firstImportStarted!: () => void;
        const firstImportStartedPromise = new Promise<void>((resolve) => {
            firstImportStarted = resolve;
        });
        let firstMarker: CorrelationMarker | undefined;
        let lateControl: LoaderControl | undefined;
        let importCount = 0;
        publicImportOverride.current = (_source, scene, options) => {
            importCount += 1;
            if (importCount === 1) {
                firstMarker = getCorrelationMarker(options);
                lateControl = createLoaderControl(MeshBuilder.CreateBox("late-abort-activation", { size: 1 }, scene), firstMarker);
                firstImportStarted();
                return new Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>(() => undefined);
            }

            const control = createLoaderControl(MeshBuilder.CreateBox("after-abort", { size: 1 }, scene), getCorrelationMarker(options));
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            control.resolveReady();
            control.complete();
            return control.readyPromise;
        };

        const build = asset.buildAsync();
        let rebuild: Promise<void> | undefined;
        try {
            await firstImportStartedPromise;
            expect(SceneLoader.OnPluginActivatedObservable.observers).toHaveLength(activationObserverCount + 1);
            const state = input.state;
            if (state === undefined || firstMarker === undefined || lateControl === undefined) {
                throw new Error("Expected the active build state and correlation marker.");
            }

            state._dispose();
            expect(SceneLoader.OnPluginActivatedObservable.observers).toHaveLength(activationObserverCount);

            SceneLoader.OnPluginActivatedObservable.notifyObservers(lateControl.plugin);
            expect(SceneLoader.OnPluginActivatedObservable.observers).toHaveLength(activationObserverCount);
            await expect(build).rejects.toThrow('Parse GLB block "parse" failed');

            rebuild = asset.buildAsync();
            await expect(rebuild).resolves.toBeUndefined();
            expect(importCount).toBe(2);
        } finally {
            publicImportOverride.current = undefined;
            await build.catch(() => undefined);
            await rebuild?.catch(() => undefined);
            asset.dispose();
        }
    });

    it("supports a glTF loader wrapper imported before the package build", async () => {
        const fixture = await createGlbFixtureAsync();
        await import("@babylonjs/loaders/glTF/2.0/glTFLoader.js");

        const result = await buildRoundtripAsync(fixture.bytes);
        expect(await readGlbStructureAsync(result)).toEqual(fixture.structure);
    });

    it("observes completion emitted before READY", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        let readyResolved = false;
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("immediate-completion", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            queueMicrotask(() => {
                SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
                control.complete();
                control.resolveReady();
                readyResolved = true;
            });
            return control.readyPromise;
        };

        try {
            await expect(graph.asset.buildAsync()).resolves.toBeUndefined();
            expect(readyResolved).toBe(true);
        } finally {
            publicImportOverride.current = undefined;
            graph.asset.dispose();
        }
    });

    it("serializes after COMPLETE even when READY never settles", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        let control: LoaderControl | undefined;
        let readySettled = false;
        publicImportOverride.current = (_source, scene, options) => {
            const loaderControl = createLoaderControl(MeshBuilder.CreateBox("complete-before-ready", { size: 1 }, scene), getCorrelationMarker(options));
            control = loaderControl;
            void loaderControl.readyPromise.then(
                () => {
                    readySettled = true;
                },
                () => {
                    readySettled = true;
                }
            );
            SceneLoader.OnPluginActivatedObservable.notifyObservers(loaderControl.plugin);
            loaderControl.complete();
            return loaderControl.readyPromise;
        };

        const build = graph.asset.buildAsync();
        try {
            await expect(
                Promise.race([
                    build.then(() => "built" as const),
                    new Promise<"timed out">((resolve) => {
                        setTimeout(() => resolve("timed out"), 1_000);
                    }),
                ])
            ).resolves.toBe("built");
            if (control === undefined) {
                throw new Error("Expected the matching GLB loader control.");
            }

            expect(readySettled).toBe(false);
            expect(control.plugin.onCompleteObservable.observers).toHaveLength(0);
            expect(control.plugin.onErrorObservable.observers).toHaveLength(0);
            expect(new TextDecoder().decode(graph.output.data.subarray(0, 4))).toBe("glTF");

            control.rejectReady(new Error("late READY rejection"));
            await Promise.resolve();
            expect(readySettled).toBe(true);
        } finally {
            publicImportOverride.current = undefined;
            control?.resolveReady();
            await build.catch(() => undefined);
            graph.asset.dispose();
        }
    });

    it("observes completion emitted during import activation", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("synchronous-completion", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            control.complete();
            control.resolveReady();
            return control.readyPromise;
        };

        try {
            await expect(graph.asset.buildAsync()).resolves.toBeUndefined();
        } finally {
            publicImportOverride.current = undefined;
            graph.asset.dispose();
        }
    });

    it("observes an error emitted before READY", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        const failure = new Error("forced pre-ready loader failure");
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("immediate-error", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            queueMicrotask(() => {
                SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
                control.fail(failure);
                control.resolveReady();
            });
            return control.readyPromise;
        };

        try {
            await expect(graph.asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed: forced pre-ready loader failure');
        } finally {
            publicImportOverride.current = undefined;
            graph.asset.dispose();
        }
    });

    it("rolls back lifecycle observers when error observer setup fails", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        const completeObservable = new Observable<void>();
        const errorObservable = new Observable<unknown>();
        const completeAdd = vi.spyOn(completeObservable, "addOnce");
        const errorAdd = vi.spyOn(errorObservable, "addOnce").mockImplementation(() => {
            throw new Error("forced lifecycle observer setup failure");
        });
        const activationObserverCount = SceneLoader.OnPluginActivatedObservable.observers.length;
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("observer-setup-failure", { size: 1 }, scene);
            const onParsed = getCorrelationMarker(options);
            const plugin: PublicLoaderPlugin = {
                name: "gltf",
                extensions: {
                    ".glb": {
                        isBinary: true,
                    },
                },
                importMeshAsync: () => Promise.resolve(createEmptyImportResult()),
                loadAsync: () => Promise.resolve(),
                loadAssetContainerAsync: () => Promise.reject(new Error("unused test plugin operation")),
                onCompleteObservable: completeObservable,
                onErrorObservable: errorObservable,
                onParsedObservable: (() => {
                    const observable = new Observable<IGLTFLoaderData>();
                    observable.add(onParsed);
                    return observable;
                })(),
            };
            SceneLoader.OnPluginActivatedObservable.notifyObservers(plugin);
            return Promise.resolve(createImportResult(mesh));
        };

        try {
            await expect(graph.asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed: forced lifecycle observer setup failure');
            expect(completeAdd).toHaveBeenCalledTimes(1);
            expect(completeObservable.observers).toHaveLength(0);
            expect(errorAdd).toHaveBeenCalledTimes(1);
            expect(errorObservable.observers).toHaveLength(0);
            expect(SceneLoader.OnPluginActivatedObservable.observers).toHaveLength(activationObserverCount);
        } finally {
            publicImportOverride.current = undefined;
            completeAdd.mockRestore();
            errorAdd.mockRestore();
            graph.asset.dispose();
        }
    });

    it("waits for public loader completion before serializing or disposing", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        const loaderControls: LoaderControl[] = [];
        let importStarted!: () => void;
        const importStartedPromise = new Promise<void>((resolve) => {
            importStarted = resolve;
        });
        const serialize = vi.spyOn(GLTF2Export, "GLBAsync");
        const sceneDispose = vi.spyOn(Scene.prototype, "dispose");
        const engineDispose = vi.spyOn(NullEngine.prototype, "dispose");
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("delayed-completion", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            loaderControls.push(control);
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            importStarted();
            return control.readyPromise;
        };

        try {
            const build = graph.asset.buildAsync();
            await importStartedPromise;
            await Promise.resolve();

            expect(serialize).not.toHaveBeenCalled();
            expect(sceneDispose).not.toHaveBeenCalled();
            expect(engineDispose).not.toHaveBeenCalled();

            const control = loaderControls[0];
            if (control === undefined) {
                throw new Error("Expected the delayed loader control.");
            }
            control.resolveReady();
            await Promise.resolve();

            expect(serialize).not.toHaveBeenCalled();
            expect(sceneDispose).not.toHaveBeenCalled();
            expect(engineDispose).not.toHaveBeenCalled();
            control.complete();

            await expect(build).resolves.toBeUndefined();
            expect(serialize).toHaveBeenCalledTimes(1);
            expect(sceneDispose).toHaveBeenCalledTimes(1);
            expect(engineDispose).toHaveBeenCalledTimes(1);
        } finally {
            publicImportOverride.current = undefined;
            serialize.mockRestore();
            sceneDispose.mockRestore();
            engineDispose.mockRestore();
            graph.asset.dispose();
        }
    });

    it("preserves a post-ready loader error and cleans up before rejecting", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        const loaderControls: LoaderControl[] = [];
        let importStarted!: () => void;
        const importStartedPromise = new Promise<void>((resolve) => {
            importStarted = resolve;
        });
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
        const serialize = vi.spyOn(GLTF2Export, "GLBAsync");
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("post-ready-error", { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            loaderControls.push(control);
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            importStarted();
            return control.readyPromise;
        };

        try {
            const build = graph.asset.buildAsync();
            await importStartedPromise;
            await Promise.resolve();

            const control = loaderControls[0];
            if (control === undefined) {
                throw new Error("Expected the post-ready loader control.");
            }
            control.resolveReady();
            await Promise.resolve();
            control.fail(new Error("forced post-ready loader failure"));

            await expect(build).rejects.toThrow('Parse GLB block "parse" failed: forced post-ready loader failure');
            expect(serialize).not.toHaveBeenCalled();
            expect(() => graph.output.data).toThrow('Output block "destination"');
            expect(disposalOrder).toEqual(["container", "mesh", "geometry", "scene", "engine"]);
        } finally {
            publicImportOverride.current = undefined;
            serialize.mockRestore();
            geometryDispose.mockRestore();
            meshDispose.mockRestore();
            containerDispose.mockRestore();
            sceneDispose.mockRestore();
            engineDispose.mockRestore();
            graph.asset.dispose();
        }
    });

    it("keeps concurrent asynchronously activated loader lifecycles independent", async () => {
        const fixture = await createGlbFixtureAsync();
        const firstGraph = createRoundtripGraph(fixture.bytes);
        const secondGraph = createRoundtripGraph(fixture.bytes);
        const loaderControls: LoaderControl[] = [];
        let bothImportsStarted!: () => void;
        const bothImportsStartedPromise = new Promise<void>((resolve) => {
            bothImportsStarted = resolve;
        });
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox(`concurrent-${loaderControls.length}`, { size: 1 }, scene);
            const control = createLoaderControl(mesh, getCorrelationMarker(options));
            loaderControls.push(control);
            queueMicrotask(() => {
                SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
                if (loaderControls.length === 2) {
                    bothImportsStarted();
                }
                control.resolveReady();
            });
            return control.readyPromise;
        };

        try {
            const firstBuild = firstGraph.asset.buildAsync();
            const secondBuild = secondGraph.asset.buildAsync();
            await bothImportsStartedPromise;
            await Promise.resolve();

            let firstSettled = false;
            const firstCompletion = firstBuild.then(() => {
                firstSettled = true;
            });
            const secondControl = loaderControls[1];
            if (secondControl === undefined) {
                throw new Error("Expected the second loader control.");
            }
            secondControl.complete();
            await expect(secondBuild).resolves.toBeUndefined();
            expect(firstSettled).toBe(false);

            const firstControl = loaderControls[0];
            if (firstControl === undefined) {
                throw new Error("Expected the first loader control.");
            }
            firstControl.complete();
            await expect(firstCompletion).resolves.toBeUndefined();
            expect(firstSettled).toBe(true);
        } finally {
            publicImportOverride.current = undefined;
            firstGraph.asset.dispose();
            secondGraph.asset.dispose();
        }
    });

    it("ignores an unrelated external glTF activation during its capture window", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        let externalControl: LoaderControl | undefined;
        let nodeAssetsControl: LoaderControl | undefined;
        publicImportOverride.current = (_source, scene, options) => {
            externalControl = createLoaderControl(MeshBuilder.CreateBox("external-load", { size: 1 }, scene));
            nodeAssetsControl = createLoaderControl(MeshBuilder.CreateBox("node-assets-load", { size: 1 }, scene), getCorrelationMarker(options));
            SceneLoader.OnPluginActivatedObservable.notifyObservers(externalControl.plugin);
            SceneLoader.OnPluginActivatedObservable.notifyObservers(nodeAssetsControl.plugin);
            nodeAssetsControl.resolveReady();
            nodeAssetsControl.complete();
            return nodeAssetsControl.readyPromise;
        };

        const build = graph.asset.buildAsync();
        try {
            await expect(
                Promise.race([
                    build.then(() => "built" as const),
                    new Promise<"timed out">((resolve) => {
                        setTimeout(() => resolve("timed out"), 1_000);
                    }),
                ])
            ).resolves.toBe("built");
        } finally {
            publicImportOverride.current = undefined;
            externalControl?.complete();
            await build.catch(() => undefined);
            graph.asset.dispose();
        }
    });

    it("aborts lifecycle observation synchronously after COMPLETE while READY remains pending", async () => {
        const fixture = await createGlbFixtureAsync();
        const input = new StateCapturingFileBlock("source", fixture.bytes);
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        let importStarted!: () => void;
        const importStartedPromise = new Promise<void>((resolve) => {
            importStarted = resolve;
        });
        let control: LoaderControl | undefined;
        let completionFired = false;
        let readySettled = false;
        publicImportOverride.current = (_source, scene, options) => {
            const loaderControl = createLoaderControl(MeshBuilder.CreateBox("aborted-load", { size: 1 }, scene), getCorrelationMarker(options));
            control = loaderControl;
            void loaderControl.readyPromise.then(() => {
                readySettled = true;
            });
            SceneLoader.OnPluginActivatedObservable.notifyObservers(loaderControl.plugin);
            loaderControl.complete();
            completionFired = true;
            importStarted();
            return loaderControl.readyPromise;
        };

        const build = asset.buildAsync();
        try {
            await importStartedPromise;
            const loaderControl = control;
            const state = input.state;
            if (loaderControl === undefined || state === undefined) {
                throw new Error("Expected the GLB loader and build state.");
            }

            expect(completionFired).toBe(true);
            expect(readySettled).toBe(false);
            expect(loaderControl.plugin.onCompleteObservable.observers).toHaveLength(1);
            expect(loaderControl.plugin.onErrorObservable.observers).toHaveLength(1);

            state._dispose();

            expect(loaderControl.plugin.onCompleteObservable.observers).toHaveLength(0);
            expect(loaderControl.plugin.onErrorObservable.observers).toHaveLength(0);

            loaderControl.resolveReady();
            loaderControl.fail(new Error("late loader error"));
            const error = await build.catch((reason: unknown) => reason);
            expect(error).toBeInstanceOf(Error);
            if (error instanceof Error) {
                expect(error.message).toContain('Parse GLB block "parse" failed');
            }

            publicImportOverride.current = undefined;
            await expect(asset.buildAsync()).resolves.toBeUndefined();
        } finally {
            publicImportOverride.current = undefined;
            control?.resolveReady();
            await build.catch(() => undefined);
            asset.dispose();
        }
    });

    it("rejects an activation that does not preserve the per-call marker", async () => {
        const fixture = await createGlbFixtureAsync();
        const graph = createRoundtripGraph(fixture.bytes);
        publicImportOverride.current = (_source, scene) => {
            const control = createLoaderControl(MeshBuilder.CreateBox("unmarked-load", { size: 1 }, scene));
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            control.resolveReady();
            return control.readyPromise;
        };

        const build = graph.asset.buildAsync();
        try {
            await expect(
                Promise.race([
                    build,
                    new Promise<"timed out">((resolve) => {
                        setTimeout(() => resolve("timed out"), 1_000);
                    }),
                ])
            ).rejects.toThrow('Parse GLB block "parse" failed: The public GLB loader did not preserve the per-call activation marker.');
        } finally {
            publicImportOverride.current = undefined;
            await build.catch(() => undefined);
            graph.asset.dispose();
        }
    });

    it("resolves URL-backed GLB resources against the fetched asset directory", async () => {
        const fixture = await createGlbFixtureAsync();
        const sourceUrl = "https://example.test/assets/model.glb";
        const externalResourceUrl = "https://example.test/assets/meshes/fixture.bin";
        const externalGlb = withExternalBufferUri(fixture.bytes, "meshes/fixture.bin");
        const binaryChunk = getGlbBinaryChunk(fixture.bytes);
        const input = new InputBlock("source");
        const parse = new ParseGLBBlock("parse");
        const serialize = new SerializeGLBBlock("serialize");
        const output = new OutputBlock("destination");
        const asset = new NodeAsset("graph");
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((request) => {
            const url = getRequestUrl(request);
            if (url === sourceUrl) {
                return Promise.resolve(new Response(toArrayBuffer(externalGlb)));
            }
            if (url === externalResourceUrl) {
                return Promise.resolve(new Response(toArrayBuffer(binaryChunk)));
            }

            return Promise.reject(new Error(`Unexpected fetch URL "${url}".`));
        });
        vi.stubGlobal("XMLHttpRequest", FetchBackedXMLHttpRequest);

        input.source = sourceUrl;
        input.output.connectTo(parse.input);
        parse.output.connectTo(serialize.input);
        serialize.output.connectTo(output.input);
        asset.addOutputBlock(output);

        try {
            await expect(asset.buildAsync()).resolves.toBeUndefined();
            expect(fetchSpy.mock.calls.map(([request]) => getRequestUrl(request))).toEqual([sourceUrl, externalResourceUrl]);
            expect(new TextDecoder().decode(output.data.subarray(0, 4))).toBe("glTF");
        } finally {
            vi.unstubAllGlobals();
            fetchSpy.mockRestore();
            asset.dispose();
        }
    });

    it("passes build-scoped URL preprocessing through public glTF plugin options", async () => {
        const fixture = await createGlbFixtureAsync();
        const sourceUrl = "https://example.test/assets/models/model.glb?version=1#fragment";
        const graph = createRoundtripGraph(sourceUrl);
        const inMemoryGraph = createRoundtripGraph(fixture.bytes);
        const preprocessors: Array<{ rootUrl: string | undefined; preprocessUrlAsync: UrlPreprocessor }> = [];
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(toArrayBuffer(fixture.bytes)));
        publicImportOverride.current = (_source, scene, options) => {
            preprocessors.push({
                rootUrl: options?.rootUrl,
                preprocessUrlAsync: getPreprocessUrlAsync(options),
            });
            const control = createLoaderControl(MeshBuilder.CreateBox("url-options-load", { size: 1 }, scene), getCorrelationMarker(options));
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            control.resolveReady();
            control.complete();
            return control.readyPromise;
        };

        try {
            await expect(graph.asset.buildAsync()).resolves.toBeUndefined();

            const urlCapture = preprocessors.find(({ rootUrl }) => rootUrl === "https://example.test/assets/models/");
            if (urlCapture === undefined) {
                throw new Error("Expected the URL-backed GLB loader options.");
            }

            const rootUrl = urlCapture.rootUrl;
            if (rootUrl === undefined) {
                throw new Error("Expected the URL-backed GLB root URL.");
            }

            await expect(urlCapture.preprocessUrlAsync(`${rootUrl}textures/a.png?version=2#fragment`)).resolves.toBe(
                "https://example.test/assets/models/textures/a.png?version=2#fragment"
            );
            await expect(urlCapture.preprocessUrlAsync(`${rootUrl}../shared/a.bin`)).resolves.toBe("https://example.test/assets/shared/a.bin");
            await expect(urlCapture.preprocessUrlAsync(`${rootUrl}/root.bin`)).resolves.toBe("https://example.test/root.bin");
            await expect(urlCapture.preprocessUrlAsync(`${rootUrl}https://cdn.other/a.bin?version=3#fragment`)).resolves.toBe("https://cdn.other/a.bin?version=3#fragment");
            await expect(urlCapture.preprocessUrlAsync("textures/direct.bin")).resolves.toBe("https://example.test/assets/models/textures/direct.bin");
            const dataUrl = "data:application/octet-stream;base64,AA==";
            await expect(urlCapture.preprocessUrlAsync(dataUrl)).resolves.toBe(dataUrl);

            await expect(inMemoryGraph.asset.buildAsync()).resolves.toBeUndefined();
            const emptyRootCapture = preprocessors.find(({ rootUrl }) => rootUrl === "");
            if (emptyRootCapture === undefined) {
                throw new Error("Expected the in-memory GLB loader options.");
            }
            await expect(emptyRootCapture.preprocessUrlAsync("textures/a.png")).resolves.toBe("textures/a.png");
        } finally {
            publicImportOverride.current = undefined;
            fetchSpy.mockRestore();
            graph.asset.dispose();
            inMemoryGraph.asset.dispose();
        }
    });

    it("keeps URL preprocessing scoped to concurrent builds", async () => {
        const fixture = await createGlbFixtureAsync();
        const firstUrl = "https://example.test/first/model.glb";
        const secondUrl = "https://example.test/second/model.glb";
        const firstGraph = createRoundtripGraph(firstUrl);
        const secondGraph = createRoundtripGraph(secondUrl);
        const preprocessors: Array<{ rootUrl: string | undefined; preprocessUrlAsync: UrlPreprocessor }> = [];
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((request) => {
            const url = getRequestUrl(request);
            if (url !== firstUrl && url !== secondUrl) {
                return Promise.reject(new Error(`Unexpected fetch URL "${url}".`));
            }

            return Promise.resolve(new Response(toArrayBuffer(fixture.bytes)));
        });
        publicImportOverride.current = (_source, scene, options) => {
            preprocessors.push({
                rootUrl: options?.rootUrl,
                preprocessUrlAsync: getPreprocessUrlAsync(options),
            });
            const control = createLoaderControl(MeshBuilder.CreateBox("concurrent-url-load", { size: 1 }, scene), getCorrelationMarker(options));
            SceneLoader.OnPluginActivatedObservable.notifyObservers(control.plugin);
            control.resolveReady();
            control.complete();
            return control.readyPromise;
        };

        try {
            await expect(Promise.all([firstGraph.asset.buildAsync(), secondGraph.asset.buildAsync()])).resolves.toEqual([undefined, undefined]);

            const firstCapture = preprocessors.find(({ rootUrl }) => rootUrl === "https://example.test/first/");
            const secondCapture = preprocessors.find(({ rootUrl }) => rootUrl === "https://example.test/second/");
            if (firstCapture === undefined || secondCapture === undefined) {
                throw new Error("Expected distinct URL roots for concurrent GLB builds.");
            }

            await expect(firstCapture.preprocessUrlAsync(`${firstCapture.rootUrl}textures/a.png`)).resolves.toBe("https://example.test/first/textures/a.png");
            await expect(secondCapture.preprocessUrlAsync(`${secondCapture.rootUrl}textures/a.png`)).resolves.toBe("https://example.test/second/textures/a.png");
        } finally {
            publicImportOverride.current = undefined;
            fetchSpy.mockRestore();
            firstGraph.asset.dispose();
            secondGraph.asset.dispose();
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
        publicImportOverride.current = (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("partial-import", { size: 1 }, scene);
            SceneLoader.OnPluginActivatedObservable.notifyObservers(createLoaderControl(mesh, getCorrelationMarker(options)).plugin);
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
        publicImportOverride.current = async (_source, scene, options) => {
            const mesh = MeshBuilder.CreateBox("partial-completion", { size: 1 }, scene);
            SceneLoader.OnPluginActivatedObservable.notifyObservers(createLoaderControl(mesh, getCorrelationMarker(options)).plugin);
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

    it("rejects GLBs that require the disabled spec-gloss extension", async () => {
        const fixture = await createGlbFixtureAsync();
        const extension = "KHR_materials_pbrSpecularGlossiness";
        const requiredFixture = withRequiredExtension(fixture.bytes, extension);
        const graph = createRoundtripGraph(requiredFixture.bytes);

        try {
            expect(requiredFixture.document.extensionsUsed).toContain(extension);
            expect(requiredFixture.document.extensionsRequired).toContain(extension);
            expect(requiredFixture.document.materials?.[0]?.extensions).toHaveProperty(extension);
            await expect(graph.asset.buildAsync()).rejects.toThrow('Parse GLB block "parse" failed: Required extension KHR_materials_pbrSpecularGlossiness is disabled');
        } finally {
            graph.asset.dispose();
        }
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
    const graph = createRoundtripGraph(source);

    try {
        await graph.asset.buildAsync();
        return graph.output.data;
    } finally {
        graph.asset.dispose();
    }
}

function createRoundtripGraph(source: InputSource): RoundtripGraph {
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

    return { asset, output };
}

interface GlbDocument {
    buffers?: Array<{ byteLength: number; uri?: string }>;
    extensionsRequired?: string[];
    extensionsUsed?: string[];
    materials?: Array<{ extensions?: Record<string, unknown> }>;
}

interface RequiredExtensionFixture {
    readonly bytes: Uint8Array;
    readonly document: GlbDocument;
}

function withRequiredExtension(bytes: Uint8Array, extension: string): RequiredExtensionFixture {
    const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = inputView.getUint32(12, true);
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonLength;
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd))) as GlbDocument;
    document.extensionsUsed = addUniqueExtension(document.extensionsUsed, extension);
    document.extensionsRequired = addUniqueExtension(document.extensionsRequired, extension);
    const material = document.materials?.[0];
    if (material === undefined) {
        throw new Error("Expected the GLB fixture to contain a material.");
    }
    material.extensions = {
        ...material.extensions,
        [extension]: {
            diffuseFactor: [0.8, 0.7, 0.6, 1],
            glossinessFactor: 0.5,
            specularFactor: [0.04, 0.04, 0.04],
        },
    };

    const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
    const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
    const result = new Uint8Array(bytes.byteLength + paddedJsonLength - jsonLength);
    result.set(bytes.subarray(0, jsonStart));
    result.set(jsonBytes, jsonStart);
    result.fill(0x20, jsonStart + jsonBytes.byteLength, jsonStart + paddedJsonLength);
    result.set(bytes.subarray(jsonEnd), jsonStart + paddedJsonLength);

    const resultView = new DataView(result.buffer);
    resultView.setUint32(8, result.byteLength, true);
    resultView.setUint32(12, paddedJsonLength, true);
    return { bytes: result, document };
}

function addUniqueExtension(extensions: readonly string[] | undefined, extension: string): string[] {
    return [...new Set([...(extensions ?? []), extension])];
}

function withExternalBufferUri(bytes: Uint8Array, uri: string): Uint8Array {
    const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = inputView.getUint32(12, true);
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonLength;
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd))) as GlbDocument;
    const buffer = document.buffers?.[0];
    if (buffer === undefined) {
        throw new Error("Expected the GLB fixture to contain a buffer.");
    }
    buffer.uri = uri;
    const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
    const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
    const result = new Uint8Array(jsonStart + paddedJsonLength);
    result.set(bytes.subarray(0, 20));
    result.set(jsonBytes, jsonStart);
    result.fill(0x20, jsonStart + jsonBytes.byteLength, jsonStart + paddedJsonLength);

    const resultView = new DataView(result.buffer);
    resultView.setUint32(8, result.byteLength, true);
    resultView.setUint32(12, paddedJsonLength, true);
    return result;
}

function getGlbBinaryChunk(bytes: Uint8Array): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const binaryLength = view.getUint32(20 + jsonLength, true);
    return bytes.slice(28 + jsonLength, 28 + jsonLength + binaryLength);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

function getRequestUrl(request: Parameters<typeof fetch>[0]): string {
    if (typeof request === "string") {
        return request;
    }

    return request instanceof URL ? request.href : request.url;
}

class FetchBackedXMLHttpRequest {
    public static readonly DONE = 4;
    public readyState = 0;
    public status = 0;
    public statusText = "";
    public response: ArrayBuffer | null = null;
    public responseURL = "";
    public responseType: XMLHttpRequestResponseType = "";
    public timeout = 0;
    public onprogress: ((this: XMLHttpRequest, event: ProgressEvent) => unknown) | null = null;

    private readonly listeners = new Map<string, Set<() => void>>();
    private requestUrl = "";

    public open(_method: string, url: string, _async = true): void {
        this.requestUrl = url;
        this.responseURL = url;
        this.readyState = 1;
    }

    public setRequestHeader(_name: string, _value: string): void {
        // The test request harness does not need to forward headers.
    }

    public addEventListener(type: string, listener: () => void): void {
        const listeners = this.listeners.get(type) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    public removeEventListener(type: string, listener: () => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    public send(): void {
        void fetch(this.requestUrl).then(
            async (response) => {
                this.status = response.status;
                this.statusText = response.statusText;
                this.responseURL = response.url || this.requestUrl;
                this.response = await response.arrayBuffer();
                this.readyState = FetchBackedXMLHttpRequest.DONE;
                this.notify("readystatechange");
                this.notify("loadend");
            },
            () => {
                this.readyState = FetchBackedXMLHttpRequest.DONE;
                this.notify("readystatechange");
                this.notify("loadend");
            }
        );
    }

    public abort(): void {
        this.readyState = FetchBackedXMLHttpRequest.DONE;
    }

    public getResponseHeader(_name: string): string | null {
        return null;
    }

    private notify(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener();
        }
    }
}

interface RoundtripGraph {
    readonly asset: NodeAsset;
    readonly output: OutputBlock;
}

function createLoaderControl(mesh: Mesh, correlationMarker?: CorrelationMarker): LoaderControl {
    const completeObservable = new Observable<void>();
    const errorObservable = new Observable<unknown>();
    const parsedObservable = new Observable<IGLTFLoaderData>();
    if (correlationMarker !== undefined) {
        parsedObservable.add(correlationMarker);
    }

    let resolveReady!: (result: SceneLoaderTypes.ISceneLoaderAsyncResult) => void;
    let rejectReady!: (reason: unknown) => void;
    const readyPromise = new Promise<SceneLoaderTypes.ISceneLoaderAsyncResult>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const plugin: PublicLoaderPlugin = {
        name: "gltf",
        extensions: {
            ".glb": {
                isBinary: true,
            },
        },
        importMeshAsync: () => Promise.resolve(createEmptyImportResult()),
        loadAsync: () => Promise.resolve(),
        loadAssetContainerAsync: () => Promise.reject(new Error("unused test plugin operation")),
        onCompleteObservable: completeObservable,
        onErrorObservable: errorObservable,
        onParsedObservable: parsedObservable,
    };

    return {
        plugin,
        readyPromise,
        complete: () => completeObservable.notifyObservers(undefined),
        fail: (reason) => errorObservable.notifyObservers(reason),
        rejectReady,
        resolveReady: () => resolveReady(createImportResult(mesh)),
    };
}

function getCorrelationMarker(options: ImportMeshAsyncArguments[2]): CorrelationMarker {
    const gltfOptions = options?.pluginOptions?.gltf;
    if (typeof gltfOptions !== "object" || gltfOptions === null || typeof gltfOptions.onParsed !== "function") {
        throw new Error("Expected the ParseGLBBlock glTF correlation marker.");
    }

    return gltfOptions.onParsed;
}

function getPreprocessUrlAsync(options: ImportMeshAsyncArguments[2]): UrlPreprocessor {
    const gltfOptions = options?.pluginOptions?.gltf;
    if (typeof gltfOptions !== "object" || gltfOptions === null || typeof gltfOptions.preprocessUrlAsync !== "function") {
        throw new Error("Expected the ParseGLBBlock glTF URL preprocessor.");
    }

    return gltfOptions.preprocessUrlAsync;
}

function createImportResult(mesh: Mesh): SceneLoaderTypes.ISceneLoaderAsyncResult {
    return {
        meshes: [mesh],
        particleSystems: [],
        skeletons: [],
        animationGroups: [],
        transformNodes: [],
        geometries: [],
        lights: [],
        spriteManagers: [],
    };
}

function createEmptyImportResult(): SceneLoaderTypes.ISceneLoaderAsyncResult {
    return {
        meshes: [],
        particleSystems: [],
        skeletons: [],
        animationGroups: [],
        transformNodes: [],
        geometries: [],
        lights: [],
        spriteManagers: [],
    };
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
