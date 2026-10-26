import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { AppendSceneAsync } from "@babylonjs/core/Loading/sceneLoader";
import { SceneLoaderFlags } from "@babylonjs/core/Loading/sceneLoaderFlags";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import { CubeMapToSphericalPolynomialTools } from "@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial";
import { RegisterInstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.pure";
import { RegisterGLTF2Loader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure";
import { RegisterGLTFFileLoader } from "@babylonjs/loaders/glTF/glTFFileLoader.pure";
import { registerBuiltInGLTFExtensions } from "@babylonjs/loaders/glTF/2.0/Extensions/dynamic";

import type { Frame, ReferenceResult } from "./protocol";
import { createScorer } from "./ssim";
import { emptyModelError } from "./errors";

/** Installs the browser-side reference/evaluate protocol. Called only by the renderer HTML entry. */
export function initialize(): void {
    const local = (file: string) => new URL(`/codecs/${file}`, location.origin).href;
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
    // Main-thread decoding lets the context's offline route guard cover every decoder request.
    KhronosTextureContainer2.DefaultNumWorkers = 0;
    SceneLoaderFlags.ShowLoadingScreen = false;
    RegisterInstancedMesh();
    RegisterGLTFFileLoader();
    RegisterGLTF2Loader();
    registerBuiltInGLTFExtensions();
    const canvas = document.querySelector<HTMLCanvasElement>("#render")!;
    const engine = new Engine(canvas, false, { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: true, disableWebGL2Support: false }, false);
    if (engine.webGLVersion !== 2) throw new Error("WebGL2 is required for fidelity rendering.");
    engine.setHardwareScalingLevel(1);
    const scorer = createScorer();
    let reference: { size: number; views: number; frame: Frame; prepared: ReturnType<typeof scorer.prepare>[]; pixels: Uint8Array[] } | undefined;
    let last: Uint8Array[] | undefined;

    async function renderViewsAsync(url: string, size: number, views: number, frame?: Frame) {
        engine.setSize(size, size);
        const scene = new Scene(engine);
        scene.useRightHandedSystem = true;
        scene.clearColor = new Color4(0, 0, 0, 0);
        scene.imageProcessingConfiguration.exposure = 1;
        scene.imageProcessingConfiguration.contrast = 1;
        scene.imageProcessingConfiguration.toneMappingEnabled = false;
        scene.animationsEnabled = false;
        try {
            scene.environmentTexture = await environmentAsync(scene);
            const start = performance.now();
            await AppendSceneAsync(url, scene, { pluginExtension: ".glb", pluginOptions: { gltf: { animationStartMode: 0 } } });
            scene.animationGroups.forEach((animation) => animation.stop());
            scene.stopAllAnimations();
            for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
            const framing = frame ?? getFrame(scene);
            const camera = new FreeCamera("fidelity-camera", Vector3.Zero(), scene);
            camera.fov = (35 * Math.PI) / 180;
            camera.minZ = framing.r * 0.01;
            camera.maxZ = framing.r * 20;
            scene.activeCamera = camera;
            await scene.whenReadyAsync();
            const loadMs = performance.now() - start;
            const pixels: Uint8Array[] = [];
            for (let i = 0; i < views; i++) {
                const azimuth = (i / views) * Math.PI * 2 + 0.4;
                const elevation = 0.35;
                const distance = (framing.r / Math.sin((17.5 * Math.PI) / 180)) * 1.05;
                camera.position.set(
                    framing.c[0] + distance * Math.cos(elevation) * Math.sin(azimuth),
                    framing.c[1] + distance * Math.sin(elevation),
                    framing.c[2] + distance * Math.cos(elevation) * Math.cos(azimuth)
                );
                camera.setTarget(Vector3.FromArray(framing.c));
                scene.render();
                const raw = await engine.readPixels(0, 0, size, size);
                const bottomUp = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                const topDown = new Uint8Array(bottomUp.length);
                const row = size * 4;
                for (let y = 0; y < size; y++) topDown.set(bottomUp.subarray((size - 1 - y) * row, (size - y) * row), y * row);
                pixels.push(topDown);
            }
            return { frame: framing, pixels, loadMs };
        } finally {
            scene.dispose();
        }
    }

    window.fidelityRenderer = {
        async setReference(url, { size, views }): Promise<ReferenceResult> {
            reference = undefined;
            last = undefined;
            const result = await renderViewsAsync(url, size, views);
            reference = { size, views, frame: result.frame, pixels: result.pixels, prepared: result.pixels.map((pixels) => scorer.prepare(pixels, size)) };
            return { frame: result.frame, loadMs: result.loadMs };
        },
        async evaluate(url) {
            if (!reference) throw new Error("No reference is loaded.");
            last = undefined;
            const result = await renderViewsAsync(url, reference.size, reference.views, reference.frame);
            let worst = 1;
            let worstView = 0;
            for (let i = 0; i < result.pixels.length; i++) {
                const score = scorer.worstTile(reference.prepared[i]!, result.pixels[i]!, reference.size);
                if (score < worst) {
                    worst = score;
                    worstView = i;
                }
            }
            last = result.pixels;
            return { worst, worstView, loadMs: result.loadMs };
        },
        preview(view) {
            if (!reference || !last || !reference.pixels[view] || !last[view]) throw new Error("No preview for this view.");
            const size = reference.size;
            const output = document.createElement("canvas");
            output.width = size * 2;
            output.height = size;
            const context = output.getContext("2d")!;
            context.fillStyle = "#404040";
            context.fillRect(0, 0, output.width, size);
            for (const [x, pixels] of [
                [0, reference.pixels[view]],
                [size, last[view]],
            ] as const) {
                const image = document.createElement("canvas");
                image.width = image.height = size;
                image.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
                context.drawImage(image, x, 0);
            }
            return output.toDataURL("image/png");
        },
    };
}

function getFrame(scene: Scene): Frame {
    const minimum = new Vector3(Infinity, Infinity, Infinity);
    const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of scene.meshes) {
        if (!mesh.getTotalVertices()) continue;
        const bounds = mesh.getBoundingInfo().boundingBox;
        minimum.minimizeInPlace(bounds.minimumWorld);
        maximum.maximizeInPlace(bounds.maximumWorld);
    }
    const center = minimum.add(maximum).scale(0.5);
    const radius = Vector3.Distance(minimum, maximum) * 0.5;
    if (!Number.isFinite(radius) || radius <= 0) throw emptyModelError();
    return { c: [center.x, center.y, center.z], r: radius };
}

async function environmentAsync(scene: Scene): Promise<RawCubeTexture> {
    const size = 32;
    const faces: Uint8Array[] = [];
    for (let face = 0; face < 6; face++) {
        const pixels = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const u = (2 * (x + 0.5)) / size - 1;
                const v = (2 * (y + 0.5)) / size - 1;
                const direction = [new Vector3(1, -v, -u), new Vector3(-1, -v, u), new Vector3(u, 1, v), new Vector3(u, -1, -v), new Vector3(u, -v, 1), new Vector3(-u, -v, -1)][
                    face
                ]!.normalize();
                const sky = 0.25 + 0.55 * (direction.y * 0.5 + 0.5);
                const light = 0.2 * Math.pow(Math.max(0, direction.x * 0.4 + direction.y * 0.8 + direction.z * 0.4), 8);
                const offset = (y * size + x) * 4;
                pixels[offset] = Math.round(Math.min(1, sky + light) * 255);
                pixels[offset + 1] = Math.round(Math.min(1, sky * 0.97 + light) * 255);
                pixels[offset + 2] = Math.round(Math.min(1, sky * 0.92 + light) * 255);
                pixels[offset + 3] = 255;
            }
        }
        faces.push(pixels);
    }
    const texture = new RawCubeTexture(scene, faces, size, Engine.TEXTUREFORMAT_RGBA, Engine.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    texture.gammaSpace = false;
    texture.coordinatesMode = Texture.CUBIC_MODE;
    texture.sphericalPolynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(texture);
    return texture;
}
