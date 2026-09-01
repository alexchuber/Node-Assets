import type { Scene as BabylonScene } from "@babylonjs/core/scene";

import { defineConnectionPointType } from "../connectionPointType";

export const BabylonSceneType = defineConnectionPointType<BabylonScene>("babylon-scene", isBabylonScene);

function isBabylonScene(value: unknown): value is BabylonScene {
    return (
        typeof value === "object" && value !== null && "getEngine" in value && typeof value.getEngine === "function" && "dispose" in value && typeof value.dispose === "function"
    );
}
