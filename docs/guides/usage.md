# Blocks

A block is a single piece of functionality. They are broadly categorized as follows:

1. Inputs: data. User supplies the value; then, graph-managed data flows out.
2. Transforms: functions. Data is managed by graph in both directions, in and out.
3. Outputs: data. Graph-managed data in, user-facing data out.

Blocks have input and output ports. Some might also have additional, optional input ports.

# Block registry

# Inputs

Named by noun.

- `GltfInputBlock`
    - Input: `string` which is a URL (HTTPS or data) that points to a glTF or GLB.
    - Output: output (BabylonScene)
    - Resources: Babylon glTF loader
    - Behavior: Uses the Babylon scene loader to load a glTF using NullEngine.
- `DracoEncoderBlock`
    - Input: none
    - Output: output (DracoEncoder)
    - Resources: Babylon default DracoEncoder
    - Behavior: Attaches to `GltfOutputBlock`'s geometryCompression port. When present, sets the glTF export's `meshCompressionMethod` option to "Draco".

# Transforms

Named by verb.

- `CompressTexturesBlock`
    - Input: input (BabylonScene)
    - Output: output (BabylonScene)
    - Resources: `babylonpress-ktx2-encoder`
    - Behavior: Applies BasisU compression to each image, resulting in .ktx2 images

# Outputs

Named by noun.

- `GltfOutputBlock`
    - Inputs: input (BabylonScene), geometryCompressor (DracoEncoder, optional)
    - Output: `File` which is a GLB
    - Resources: Babylon glTF exporter
    - Behavior: Uses GLBExport to export scene to GLB. Grabs GLB file from return of the GLBExport function. If geometryCompressor is truthy, sets meshCompressionMethod export option to "Draco".

# Example: Hello, pipeline!

Connect a `GltfInputBlock` to a `GltfOutputBlock`, then execute the resulting `NodeAsset`.

```ts
const source = new GltfInputBlock({ input: "https://assets.babylonjs.com/meshes/box.glb" });
const destination = new GltfOutputBlock();

source.output.connectTo(destination.input);

const asset = new NodeAsset({
    name: "gltf-roundtrip",
    outputBlock: destination,
});

const result = await asset.executeAsync();
```

# Example: Compressing GLB

Same as before, but now add the `CompressTexturesBlock` transform and the `DracoEncoderBlock` input.

```ts
const source = new GltfInputBlock({ input: "https://assets.babylonjs.com/meshes/box.glb" });
const compressTextures = new CompressTexturesBlock();
const dracoEncoder = new DracoEncoderBlock();
const destination = new GltfOutputBlock();

source.output.connectTo(compressTextures.input);
compressTextures.output.connectTo(destination.input);
dracoEncoder.output.connectTo(destination.geometryCompressor);

const asset = new NodeAsset({
    name: "gltf-roundtrip",
    outputBlock: destination,
});

const result = await asset.executeAsync();
```

# Creating blocks

```ts
const source = new GltfInputBlock({
    input: "box.glb",
});
const destination = new GltfOutputBlock();
```

`GltfInputBlock` accepts a URL (HTTPS or data) pointing to either a glTF or GLB. You can supply a default value for this in the constructor, as shown above.

`GltfOutputBlock` produces a `File`, which is a GLB.

# Connecting blocks

```typescript
source.output.connectTo(destination.input);
// Or
destination.input.connectTo(source.output);
```

Only ports with compatible types are able to be connected. This is enforced at author time with type-checking, then also at runtime.

# Disconnecting blocks

```typescript
source.output.disconnectFrom(destination.input);
// Or
destination.input.disconnectFrom(source.output);
```

# Creating a NodeAsset

## Setting output block

A NodeAsset's contract is defined by its output block. Whatever the output type of the output block it is assigned, that is what executeAsync will return. E.g., the return type of `executeAsync` on a NodeAsset whose output block is `GltfOutputBlock` will be a `File`.

Pass it in at construction time:

```ts
const asset = new NodeAsset({
    name: "gltf-roundtrip",
    outputBlock: destination,
});
```

# Setting values of input blocks

### Method 1. Using default values

If an `input` parameter is supplied in the constructor, it will be used as the default value for the input block. Executing the graph will use these default values.

```typescript
const source = new GltfInputBlock({ input: "box.glb" });

...

const result = await asset.executeAsync();
```

### Method 2. Using execution context

**Status: Deferred**

You can also supply input values through a `NodeAssetContext`. These values are used per-execution.

```ts
const source = new GltfInputBlock();

...

const context = new NodeAssetContext(asset);
context.setInput(source, "box.glb");

const result = await asset.executeAsync(context);
```

A context value overrides the input block's default value

```typescript
const source = new GltfInputBlock({ input: "pyramid.glb" });

...

const context = new NodeAssetContext(asset);
context.setInput(source, "box.glb");

const result1 = await asset.executeAsync(); // Will use "pyramid.glb"
const result2 = await asset.executeAsync(context); // Will use "box.glb"
```

Internally, `executeAsync` first reaches for the context values; if none given, then it uses the block-assigned default values. And if a block has no default value, execution will throw.

# Running against different inputs

**Status: Deferred**

Use one context per set of inputs.

```ts
...

const first = asset.createContext();
first.setInput(source, "https://assets.babylonjs.com/meshes/box.glb");

const second = asset.createContext();
second.setInput(source, "https://assets.babylonjs.com/meshes/BoomBox/BoomBox.gltf");
```

## Method 1: Sequential

Execute using each context:

```ts
const firstResult = await asset.executeAsync(first);
const secondResult = await asset.executeAsync(second);
```

Each NodeAsset execution owns and cleans up its resources.

## Method 2: Batched

**Status: Not planned**

To execute in batch, which can help reuse resources, executeAsync accepts an array of contexts.

```ts
const results = await asset.executeAsync([first, second]);
```

# Sharing resources

**Status: Deferred**

Use a `NodeAssetCoordinator` so that graphs can share expensive resources.

```ts
...

const coordinator = new NodeAssetCoordinator();

// TODO: This? Or inject coordinator?
const asset1 = coordinator.createNodeAsset({
    name: "graph1",
    outputBlock: destination1,
    coordinator
});

const asset2 = coordinator.createNodeAsset({
    name: "graph2",
    outputBlock: destination2,
    coordinator
});

const firstResult = await coordinator.executeAsync(asset1);
const secondResult = await coordinator.executeAsync(asset2);

await coordinator.dispose();
```

The coordinator must:

- create required resources lazily;
- reuse a resource across its executions;
- keep context values isolated;
- wait for required resources before execution; and
- dispose its resources.

## Run same graph, different contexts, in batch

**Status: Deferred**

Pass contexts as an array.

```ts
const results = await coordinator.executeAsync(asset, [first, second]);
```

The coordinator must run the contexts concurrently and return one result for each context.
