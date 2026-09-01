import { InputBlock, type InputBlockOptions } from "../block";
import { defineSwitchInputBlock } from "../blockDefinition";
import { ParseGltfToBabylonBlock } from "../parsers/gltfToBabylonScene";
import { BabylonSceneType, GltfBytesType } from "../../gltfValues";

const GltfInputBlockDefinition = defineSwitchInputBlock({
    type: "gltf.input",
    input: GltfBytesType,
    output: BabylonSceneType,
    resolveBlock: (data) => new ParseGltfToBabylonBlock({ container: isGlb(data) ? "glb" : "gltf" }),
});

export class GltfInputBlock extends InputBlock<typeof GltfInputBlockDefinition> {
    public constructor(options?: InputBlockOptions<typeof GltfInputBlockDefinition>) {
        super(GltfInputBlockDefinition, options);
    }
}

function isGlb(data: Uint8Array): boolean {
    return data.length >= 4 && data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x46;
}
