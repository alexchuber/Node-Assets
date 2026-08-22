import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";
import { type ConnectionPoint } from "./connectionPoint";
import { NodeAssetBlock } from "./nodeAssetBlock";

export class SerializeGLBBlock extends NodeAssetBlock {
    public readonly input: ConnectionPoint<"SceneAsset", "input">;
    public readonly output: ConnectionPoint<"File", "output">;

    public constructor(name: string) {
        super(name);
        this.input = this.registerInput("input", "SceneAsset");
        this.output = this.registerOutput("output", "File");
    }

    protected override async _buildAsync(): Promise<void> {
        const sceneAsset = await this.readInputAsync(this.input);
        const fileName = `${this.name}.glb`;

        try {
            const data = await GLTF2Export.GLBAsync(sceneAsset._getScene(), fileName);
            const file = data.files[fileName];
            if (file === undefined || typeof file === "string") {
                throw new Error("The GLB serializer did not produce a binary file.");
            }

            this.writeOutput(this.output, new Uint8Array(await file.arrayBuffer()));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Serialize GLB block "${this.name}" failed: ${message}`, { cause: error });
        }
    }
}
