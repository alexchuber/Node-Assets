# Reuse a pipeline

**Status: Planned**

Use a `NodeAssetCoordinator` when sequential executions should share expensive resources.

```ts
import { GltfInputBlock, GltfOutputBlock, NodeAssetCoordinator } from "@babylonjs/node-assets";

const source = new GltfInputBlock();
const destination = new GltfOutputBlock();
source.output.connectTo(destination.input);

const coordinator = new NodeAssetCoordinator();
const asset = coordinator.createNodeAsset({
    name: "gltf-to-glb",
    outputBlock: destination,
});

const first = asset.createContext();
first.setInput(source, "https://assets.babylonjs.com/meshes/box.glb");

const second = asset.createContext();
second.setInput(source, "https://assets.babylonjs.com/meshes/BoomBox/BoomBox.gltf");

const firstResult = await coordinator.executeAsync(asset, first);
const secondResult = await coordinator.executeAsync(asset, second);

await coordinator.dispose();
```

The coordinator must:

- create required resources lazily;
- reuse a resource across its executions;
- keep context values isolated;
- wait for required resources before execution; and
- dispose its resources.

## Run a batch

Pass contexts as an array.

```ts
const results = await coordinator.executeAsync(asset, [first, second]);
```

The coordinator must run the contexts concurrently and return one result for each context.
