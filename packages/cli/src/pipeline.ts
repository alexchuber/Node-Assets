import { extname } from "node:path";

import type * as NodeAssets from "@babylonjs/node-assets";

export function getPipelineDefinitions() {
    return {
        inputs: [
            {
                extensions: [".gltf", ".glb"],
                create: (library: typeof NodeAssets, path: string) => new library.GltfInputBlock({ input: path }),
            },
            {
                extensions: [".fbx"],
                create: (library: typeof NodeAssets, path: string) => new library.FbxInputBlock({ input: path }),
            },
            {
                extensions: [".obj"],
                create: (library: typeof NodeAssets, path: string) => new library.ObjInputBlock({ input: path }),
            },
            {
                extensions: [".stl"],
                create: (library: typeof NodeAssets, path: string) => new library.StlInputBlock({ input: path }),
            },
            {
                extensions: [".usd", ".usda", ".usdc", ".usdz"],
                create: (library: typeof NodeAssets, path: string) => new library.UsdInputBlock({ input: path }),
            },
        ],
        outputs: [
            {
                extensions: [".glb"],
                create: (library: typeof NodeAssets) => new library.GltfOutputBlock(),
            },
        ],
        operations: [
            {
                name: "validate",
                description: "Validate the file and fail on errors",
                create: (library: typeof NodeAssets) => new library.ValidateBlock(),
            },
            {
                name: "draco",
                description: "Compress geometry with Draco",
                create: (library: typeof NodeAssets) => new library.EncodeDracoBlock(),
            },
            {
                name: "meshopt",
                description: "Compress geometry with Meshopt",
                create: (library: typeof NodeAssets) => new library.EncodeMeshoptBlock(),
            },
            {
                name: "ktx2",
                description: "Encode textures as KTX2",
                create: (library: typeof NodeAssets) => new library.EncodeKTX2Block(),
            },
            {
                name: "quantize",
                description: "Quantize mesh attributes",
                create: (library: typeof NodeAssets) => new library.QuantizeBlock(),
            },
            {
                name: "cull-unused",
                description: "Remove unused resources",
                create: (library: typeof NodeAssets) => new library.CullUnusedBlock(),
            },
            {
                name: "strip-materials",
                description: "Remove materials and their unused textures",
                create: (library: typeof NodeAssets) => new library.StripMaterialsBlock(),
            },
        ],
    };
}

interface PipelineOptions {
    readonly inputPath: string;
    readonly outputPath: string;
    readonly blockNames: readonly string[];
}

export async function createPipelineAsync({ inputPath, outputPath, blockNames }: PipelineOptions) {
    const definitions = getPipelineDefinitions();
    const inputExtension = extname(inputPath).toLowerCase();
    const outputExtension = extname(outputPath).toLowerCase();
    const inputDefinition = definitions.inputs.find(({ extensions }) => extensions.includes(inputExtension));
    const outputDefinition = definitions.outputs.find(({ extensions }) => extensions.includes(outputExtension));
    if (inputDefinition === undefined) {
        throw new Error(`Unsupported input extension "${inputExtension}".`);
    }
    if (outputDefinition === undefined) {
        throw new Error(`Unsupported output extension "${outputExtension}".`);
    }
    const transforms = blockNames.map((name) => {
        const definition = definitions.operations.find((block) => block.name === name);
        if (definition === undefined) {
            throw new Error(`Unknown operation "${name}".`);
        }
        return definition;
    });

    const library = await import("@babylonjs/node-assets");
    const source = inputDefinition.create(library, inputPath);
    let previous = source.output;
    for (const transform of transforms) {
        const block = transform.create(library);
        previous.connectTo(block.input);
        previous = block.output;
    }
    const destination = outputDefinition.create(library);
    previous.connectTo(destination.input);
    return new library.NodeAsset({ name: "pipeline", outputBlock: destination });
}
