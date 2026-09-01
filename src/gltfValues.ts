import { defineValueType } from "./blocks/blockDefinition";
import { PayloadKind, RepresentationKind, type BabylonScene, type GltfArtifact } from "./connectionValues";

export const GltfBytesType = defineValueType<Uint8Array>("gltf-bytes", (value): value is Uint8Array => value instanceof Uint8Array);

export const GltfArtifactType = defineValueType<GltfArtifact>(
    "gltf-artifact",
    (value): value is GltfArtifact =>
        typeof value === "object" &&
        value !== null &&
        "payloadKind" in value &&
        value.payloadKind === PayloadKind.Artifact &&
        "representationKind" in value &&
        value.representationKind === RepresentationKind.GLTF
);

export const BabylonSceneType = defineValueType<BabylonScene>(
    "babylon-scene",
    (value): value is BabylonScene =>
        typeof value === "object" &&
        value !== null &&
        "payloadKind" in value &&
        value.payloadKind === PayloadKind.Scene &&
        "representationKind" in value &&
        value.representationKind === RepresentationKind.Babylon
);
