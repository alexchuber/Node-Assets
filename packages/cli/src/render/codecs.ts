import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";

export function configureLocalKtx2(origin: string): void {
    const local = (file: string) => new URL(`/codecs/${file}`, origin).href;
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
}
