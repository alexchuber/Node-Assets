import type { KTX2Decoder } from "./ktx2Decoder";
import type { Resource } from "./resource";

type LazyKTX2Decoder = Pick<KTX2Decoder, "decodeAsync"> & { dispose(): void };

export const KTX2DecoderResource = {
    name: "KTX2Decoder",
    create: () => {
        let decoder: Promise<KTX2Decoder> | undefined;
        return {
            decodeAsync: async (image: Uint8Array) => {
                const instance = await (decoder ??= import("./ktx2Decoder").then(({ KTX2Decoder }) => new KTX2Decoder()));
                return instance.decodeAsync(image);
            },
            dispose: () => {
                decoder = undefined;
            },
        };
    },
    dispose: (decoder) => decoder.dispose(),
} satisfies Resource<LazyKTX2Decoder>;
