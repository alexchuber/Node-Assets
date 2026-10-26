import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { AppendSceneAsync } from "@babylonjs/core/Loading/sceneLoader";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import { RegisterInstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.pure";
import { Scene } from "@babylonjs/core/scene";
import { registerBuiltInGLTFExtensions } from "@babylonjs/loaders/glTF/2.0/Extensions/dynamic";
import { RegisterGLTF2Loader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure";
import { RegisterGLTFFileLoader } from "@babylonjs/loaders/glTF/glTFFileLoader.pure";

import { configureLocalKtx2 } from "../../src/render/codecs";

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
    configureLocalKtx2(location.origin);
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
