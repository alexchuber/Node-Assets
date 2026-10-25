import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { AppendSceneAsync } from "@babylonjs/core/Loading/sceneLoader";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import { RegisterInstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.pure";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import { Scene } from "@babylonjs/core/scene";
import { registerBuiltInGLTFExtensions } from "@babylonjs/loaders/glTF/2.0/Extensions/dynamic";
import { RegisterGLTF2Loader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure";
import { RegisterGLTFFileLoader } from "@babylonjs/loaders/glTF/glTFFileLoader.pure";

declare global {
    interface Window {
        coldLoad?: (url: string) => Promise<{ ms: number; babylonVersion: string }>;
    }
}

export function initialize(): void {
    const local = (name: string) => new URL(`/codecs/${name}`, location.origin).href;
    DracoDecoder.DefaultConfiguration = {
        wasmUrl: local("draco_wasm_wrapper_gltf.js"),
        wasmBinaryUrl: local("draco_decoder_gltf.wasm"),
        fallbackUrl: local("draco_decoder_gltf.js"),
        numWorkers: 0,
    };
    MeshoptCompression.Configuration = { decoder: { url: local("meshopt_decoder.js") } };
    KhronosTextureContainer2.URLConfig = {
        jsDecoderModule: local("ktx2Decoder.js"),
        wasmUASTCToASTC: local("uastc_astc.wasm"),
        wasmUASTCToBC7: local("uastc_bc7.wasm"),
        wasmUASTCToRGBA_UNORM: local("uastc_rgba8_unorm_v2.wasm"),
        wasmUASTCToRGBA_SRGB: local("uastc_rgba8_srgb_v2.wasm"),
        wasmUASTCToR8_UNORM: local("uastc_r8_unorm.wasm"),
        wasmUASTCToRG8_UNORM: local("uastc_rg8_unorm.wasm"),
        jsMSCTranscoder: local("msc_basis_transcoder.js"),
        wasmMSCTranscoder: local("msc_basis_transcoder.wasm"),
        wasmZSTDDecoder: local("zstddec.wasm"),
    };
    // Main-thread Draco/KTX2 keeps all decoder fetches covered by the context route guard.
    KhronosTextureContainer2.DefaultNumWorkers = 0;
    SceneLoaderFlags.ShowLoadingScreen = false;
    RegisterInstancedMesh();
    RegisterGLTFFileLoader();
    RegisterGLTF2Loader();
    registerBuiltInGLTFExtensions();
    window.coldLoad = async (url) => {
        const canvas = document.querySelector<HTMLCanvasElement>("#load")!;
        const engine = new Engine(canvas, false, {}, false);
        const scene = new Scene(engine);
        scene.useRightHandedSystem = true;
        scene.animationsEnabled = false;
        const camera = new FreeCamera("load-camera", new Vector3(0, 0, -5), scene);
        camera.setTarget(Vector3.Zero());
        scene.activeCamera = camera;
        try {
            const start = performance.now();
            await AppendSceneAsync(url, scene, { pluginExtension: ".glb", pluginOptions: { gltf: { animationStartMode: 0 } } });
            await scene.whenReadyAsync();
            return { ms: performance.now() - start, babylonVersion: Engine.Version };
        } finally {
            scene.dispose();
            engine.dispose();
        }
    };
}
