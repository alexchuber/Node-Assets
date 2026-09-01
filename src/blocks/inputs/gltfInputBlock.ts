import { InputBlock, type InputBlockOptions } from "../block";
import { defineInputBlock } from "../blockDefinition";
import { GltfArtifactType, GltfBytesType } from "../../gltfValues";
import { PayloadKind, RepresentationKind, type GltfArtifact } from "../../connectionValues";

const GltfInputBlockDefinition = defineInputBlock({
    type: "gltf.input",
    input: GltfBytesType,
    output: GltfArtifactType,
    run: (data) => createArtifact(data),
});

export class GltfInputBlock extends InputBlock<typeof GltfInputBlockDefinition> {
    public constructor(options?: InputBlockOptions<typeof GltfInputBlockDefinition>) {
        super(GltfInputBlockDefinition, options);
    }
}

function createArtifact(data: Uint8Array): GltfArtifact {
    const container = isGlb(data) ? "glb" : "gltf";
    const fileName = `scene.${container}`;
    return {
        payloadKind: PayloadKind.Artifact,
        representationKind: RepresentationKind.GLTF,
        container,
        data,
        fileName,
        files: Object.freeze({ [fileName]: data }),
    };
}

function isGlb(data: Uint8Array): boolean {
    return data.length >= 4 && data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x46;
}
