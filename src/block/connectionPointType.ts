import type { DracoEncoder } from "@babylonjs/core/Meshes/Compression/dracoEncoder.js";
import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";

declare const connectionPointData: unique symbol;

export interface ConnectionPointType<Payload> {
    readonly id: string;
    readonly [connectionPointData]: Payload;
    is(value: unknown): value is Payload;
}

export type ConnectionPointValue<C extends ConnectionPointType<unknown>> = C extends ConnectionPointType<infer TData> ? TData : never;

export function defineConnectionPointType<P>(id: string, isData: (value: unknown) => value is P): ConnectionPointType<P> {
    return Object.freeze({ id, is: isData }) as ConnectionPointType<P>;
}

// Definitions

export const UrlType = /* @__PURE__ */ defineConnectionPointType<string>("url", (value): value is string => typeof value === "string");

export const FileType = /* @__PURE__ */ defineConnectionPointType<File>("file", (value): value is File => value instanceof File);

export const DracoEncoderType = /* @__PURE__ */ defineConnectionPointType<DracoEncoder>(
    "draco-encoder",
    (value): value is DracoEncoder => typeof value === "object" && value !== null && "encodeMeshAsync" in value && typeof value.encodeMeshAsync === "function"
);

export const BabylonSceneType = /* @__PURE__ */ defineConnectionPointType<BabylonScene>(
    "babylon-scene",
    (value): value is BabylonScene =>
        typeof value === "object" && value !== null && "getEngine" in value && typeof value.getEngine === "function" && "dispose" in value && typeof value.dispose === "function"
);
