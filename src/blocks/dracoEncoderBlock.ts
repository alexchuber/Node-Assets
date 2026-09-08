import type { IDracoCodecConfiguration } from "@babylonjs/core/Meshes/Compression/dracoCodec.js";
import type { DracoEncoder as BabylonDracoEncoder } from "@babylonjs/core/Meshes/Compression/dracoEncoder.js";

import { Block, type BlockOptions } from "../block/block";
import { defineSourceBlock } from "../block/blockDefinition";
import { DracoEncoderType } from "../block/connectionPointType";

const DracoEncoderBlockDefinition = /* @__PURE__ */ defineSourceBlock({
    type: "input.draco-encoder",
    output: DracoEncoderType,
    runAsync: async () => {
        const [{ DracoEncoder }, { RegisterKHR_draco_mesh_compression }] = await Promise.all([
            import("@babylonjs/core/Meshes/Compression/dracoEncoder.js"),
            import("@babylonjs/serializers/glTF/2.0/Extensions/KHR_draco_mesh_compression.pure.js"),
        ]);
        await prepareDefaultEncoderForNodeAsync(DracoEncoder);
        RegisterKHR_draco_mesh_compression();
        return DracoEncoder.Default;
    },
});

/** Provides Babylon.js's default Draco encoder for glTF geometry compression. */
export class DracoEncoderBlock extends Block<typeof DracoEncoderBlockDefinition> {
    public constructor(options?: BlockOptions<typeof DracoEncoderBlockDefinition>) {
        super(DracoEncoderBlockDefinition, options);
    }
}

interface DracoEncoderConstructor {
    DefaultConfiguration: IDracoCodecConfiguration;
    readonly Default: BabylonDracoEncoder;
    ResetDefault(skipDispose?: boolean): void;
}

interface DracoEncoderGlobal {
    DracoEncoderModule?: DracoEncoderModuleFactory;
}

type DracoEncoderModuleFactory = (configuration: { wasmBinary: ArrayBuffer }) => Promise<unknown>;

let defaultEncoderPreparationPromise: Promise<void> | undefined;

async function prepareDefaultEncoderForNodeAsync(DracoEncoder: DracoEncoderConstructor): Promise<void> {
    if (!isNode() || !isBabylonDefaultConfiguration(DracoEncoder.DefaultConfiguration)) {
        return;
    }

    const preparationPromise = (defaultEncoderPreparationPromise ??= initializeDefaultEncoderForNodeAsync(DracoEncoder));
    try {
        await preparationPromise;
    } catch (error) {
        if (defaultEncoderPreparationPromise === preparationPromise) {
            defaultEncoderPreparationPromise = undefined;
        }
        throw error;
    }
}

async function initializeDefaultEncoderForNodeAsync(DracoEncoder: DracoEncoderConstructor): Promise<void> {
    const [{ createRequire }, { readFile }, { dirname }, { pathToFileURL }] = await Promise.all([
        import("node:module"),
        import("node:fs/promises"),
        import("node:path"),
        import("node:url"),
    ]);
    const resolve = createRequire(import.meta.url).resolve;
    const wrapperPath = resolve("@babylonjs/core/assets/Draco/draco_encoder_wasm_wrapper.js");
    const wrapperUrl = pathToFileURL(wrapperPath).href;
    const wasmBinaryPath = resolve("@babylonjs/core/assets/Draco/draco_encoder.wasm");
    const [wasmFile] = await Promise.all([readFile(wasmBinaryPath), import(/* @vite-ignore */ wrapperUrl)]);
    const moduleFactory = (globalThis as DracoEncoderGlobal).DracoEncoderModule;
    if (typeof moduleFactory !== "function") {
        throw new Error("The Babylon.js Draco encoder module did not load.");
    }

    const wasmBinary = Uint8Array.from(wasmFile).buffer;
    const module = await createNodeEncoderModuleAsync(moduleFactory, wasmBinary, dirname(wrapperPath));
    DracoEncoder.ResetDefault(true);
    DracoEncoder.DefaultConfiguration = {
        jsModule: () => Promise.resolve(module),
        numWorkers: 0,
        wasmBinary,
        wasmBinaryUrl: pathToFileURL(wasmBinaryPath).href,
        wasmUrl: wrapperUrl,
    };
}

async function createNodeEncoderModuleAsync(moduleFactory: DracoEncoderModuleFactory, wasmBinary: ArrayBuffer, wrapperDirectory: string): Promise<unknown> {
    const dirnameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__dirname");
    Object.defineProperty(globalThis, "__dirname", { configurable: true, value: wrapperDirectory });
    let modulePromise: Promise<unknown>;
    try {
        modulePromise = moduleFactory({ wasmBinary });
    } finally {
        if (dirnameDescriptor) {
            Object.defineProperty(globalThis, "__dirname", dirnameDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "__dirname");
        }
    }
    return await modulePromise;
}

function isNode(): boolean {
    return typeof process === "object" && process.versions?.node !== undefined;
}

function isBabylonDefaultConfiguration(configuration: IDracoCodecConfiguration): boolean {
    return (
        configuration.wasmUrl === "https://cdn.babylonjs.com/draco_encoder_wasm_wrapper.js" &&
        configuration.wasmBinaryUrl === "https://cdn.babylonjs.com/draco_encoder.wasm" &&
        configuration.fallbackUrl === "https://cdn.babylonjs.com/draco_encoder.js" &&
        configuration.jsModule === undefined &&
        configuration.numWorkers === undefined &&
        configuration.wasmBinary === undefined &&
        configuration.workerPool === undefined
    );
}
