import { Block, type BlockOptions } from "../block/block";
import { defineSourceBlock } from "../block/blockDefinition";
import { DracoEncoderType } from "../block/connectionPointType";

const DracoEncoderBlockDefinition = defineSourceBlock({
    type: "input.draco-encoder",
    output: DracoEncoderType,
    runAsync: async () => {
        const [{ DracoEncoder }] = await Promise.all([
            import("@babylonjs/core/Meshes/Compression/dracoEncoder.js"),
            import("@babylonjs/serializers/glTF/2.0/Extensions/KHR_draco_mesh_compression.js"),
        ]);
        return DracoEncoder.Default;
    },
});

/** Provides Babylon.js's default Draco encoder for glTF geometry compression. */
export class DracoEncoderBlock extends Block<typeof DracoEncoderBlockDefinition> {
    public constructor(options?: BlockOptions<typeof DracoEncoderBlockDefinition>) {
        super(DracoEncoderBlockDefinition, options);
    }
}
