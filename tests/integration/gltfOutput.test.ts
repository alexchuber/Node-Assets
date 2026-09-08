import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";

import { describe, expect, it } from "vitest";

import { Block } from "../../src/block/block";
import { defineBlock } from "../../src/block/blockDefinition";
import { BabylonSceneType } from "../../src/block/connectionPointType";
import { GltfInputBlock, GltfOutputBlock, NodeAsset } from "../../src/index";
import { parseGlbAsync } from "../helpers/glb";
import { generateGltfDataUri, generateTexturedGltfDataUri } from "../helpers/gltf";

describe("glTF output", () => {
    it("exports a valid GLB", async () => {
        const source = new GltfInputBlock({ input: generateGltfDataUri() });
        const destination = new GltfOutputBlock();
        source.output.connectTo(destination.input);

        await parseGlbAsync(await new NodeAsset({ name: "valid-glb", outputBlock: destination }).executeAsync());
    });

    it("preserves texture transforms", async () => {
        const transformDefinition = defineBlock({
            type: "transform-texture",
            input: BabylonSceneType,
            output: BabylonSceneType,
            run: (scene) => {
                const texture = (scene.materials[0] as PBRMaterial).albedoTexture as Texture;
                texture.uOffset = 0.25;
                texture.vOffset = 0.5;
                texture.uScale = 0.75;
                texture.vScale = 0.625;
                texture.wAng = 0.125;
                texture.uRotationCenter = 0;
                texture.vRotationCenter = 0;
                texture.coordinatesIndex = 1;
                return scene;
            },
        });
        const source = new GltfInputBlock({ input: generateTexturedGltfDataUri() });
        const transform = new Block(transformDefinition);
        const destination = new GltfOutputBlock();
        source.output.connectTo(transform.input);
        transform.output.connectTo(destination.input);

        const parsed = await parseGlbAsync(await new NodeAsset({ name: "texture-transform", outputBlock: destination }).executeAsync());
        const textureTransform = parsed.json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform;

        expect(parsed.json.extensionsUsed).toContain("KHR_texture_transform");
        expect(textureTransform).toEqual({
            offset: [0.25, 0.5],
            rotation: -0.125,
            scale: [0.75, 0.625],
            texCoord: 1,
        });
    });
});
