# Convert glTF to GLB

**Status: Implemented**

Connect a `GltfInputBlock` to a `GltfOutputBlock`, then execute the resulting `NodeAsset`.

```ts
import { GltfInputBlock, GltfOutputBlock, NodeAsset } from "@babylonjs/node-assets";

const source = new GltfInputBlock({
    input: "https://assets.babylonjs.com/meshes/box.glb",
});
const destination = new GltfOutputBlock();

source.output.connectTo(destination.input);

const asset = new NodeAsset({
    name: "gltf-to-glb",
    outputBlock: destination,
});
const result = await asset.executeAsync();

result.output; // File named "scene.glb"
```

`GltfInputBlock` accepts a glTF or GLB HTTP URL or data URL. `GltfOutputBlock` returns a `File` with the `model/gltf-binary` MIME type.

## Supply input for each execution

Leave the source input unset, then supply it through a `NodeAssetContext`.

```ts
import { GltfInputBlock, GltfOutputBlock, NodeAsset, NodeAssetContext } from "@babylonjs/node-assets";

const source = new GltfInputBlock();
const destination = new GltfOutputBlock();
source.output.connectTo(destination.input);

const asset = new NodeAsset({
    name: "gltf-to-glb",
    outputBlock: destination,
});

const input = "https://assets.babylonjs.com/meshes/box.glb";
const context = new NodeAssetContext(asset);
context.setInput(source, input);

const { output } = await asset.executeAsync(context);
```

A context value overrides the block's default input. The block must belong to the asset, and its input must be unconnected.

## Run independent inputs in parallel

Use one context per input.

```ts
const inputs = [
    "https://assets.babylonjs.com/meshes/box.glb",
    "https://assets.babylonjs.com/meshes/BoomBox/BoomBox.gltf",
];

const createContext = (input: string) => {
    const context = new NodeAssetContext(asset);
    context.setInput(source, input);
    return context;
};

const contexts = inputs.map(createContext);
const results = await Promise.all(contexts.map((context) => asset.executeAsync(context)));
```

Each execution owns and cleans up its resources. Construct the asset after connecting its blocks.
