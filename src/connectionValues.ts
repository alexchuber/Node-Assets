import type { Scene as BabylonSceneObject } from "@babylonjs/core/scene";

export enum PayloadKind {
    Scene,
    Artifact,
}

export enum RepresentationKind {
    USD,
    Babylon,
    GLTF,
}

export interface ConnectionValue<TPayloadKind extends PayloadKind, TRepresentationKind extends RepresentationKind> {
    readonly payloadKind: TPayloadKind;
    readonly representationKind: TRepresentationKind;
}

export type Artifact<TRepresentationKind extends RepresentationKind = RepresentationKind> = ConnectionValue<PayloadKind.Artifact, TRepresentationKind>;

export type Scene<TRepresentationKind extends RepresentationKind = RepresentationKind> = ConnectionValue<PayloadKind.Scene, TRepresentationKind>;

export interface GltfArtifact extends Artifact<RepresentationKind.GLTF> {
    readonly container: GltfContainer;
    readonly data: Uint8Array;
    readonly fileName: string;
    readonly files: Readonly<Record<string, string | Blob | Uint8Array>>;
}

export type GltfContainer = "gltf" | "glb";

export interface BabylonScene extends Scene<RepresentationKind.Babylon> {
    readonly scene: BabylonSceneObject;
}

export function isArtifact(value: unknown): value is Artifact {
    return typeof value === "object" && value !== null && "payloadKind" in value && value.payloadKind === PayloadKind.Artifact;
}

export function isScene(value: unknown): value is Scene {
    return typeof value === "object" && value !== null && "payloadKind" in value && value.payloadKind === PayloadKind.Scene;
}
