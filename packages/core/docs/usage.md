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

# Input locations

All input blocks accept HTTP(S) URLs and, in Node, filesystem paths and `file:` URLs.
Relative paths use the working directory.

USD input requires a global `Worker`. On Node versions that offer it behind a flag,
such as Node 26, run with `--experimental-web-worker`.

See the [CLI guide](../../cli/README.md) for command syntax and run reports.

# Serializing graphs

`parseGraph(value: unknown): Graph` reads plain objects with `graph: 1` and a
nonempty `blocks` array. Only built-in transform blocks are accepted; callers
supply input and output blocks. Each transform takes its input from the previous
block unless `input` names an earlier block's `id`. There must be one external
input and one sink. Auxiliary inputs are not supported in version 1.

```ts
const graph = parseGraph({
    graph: 1,
    blocks: [{ type: "transform.dedup" }, { type: "transform.quantize" }],
});
const source = new GltfInputBlock({ input: "box.glb" });
const destination = new GltfOutputBlock();
source.output.connectTo(graph.head.input);
graph.tail.output.connectTo(destination.input);
const asset = new NodeAsset({ name: "serialized-graph", outputBlock: destination });
const result = await asset.executeAsync();
const saved = serializeGraph(graph.blocks);
```

To supply an existing glTF Transform `Document`, leave `head.input` unconnected:

```ts
const graph = parseGraph({ graph: 1, blocks: [{ type: "transform.dedup" }] });
const destination = new GltfOutputBlock();
graph.tail.output.connectTo(destination.input);
const asset = new NodeAsset({ name: "document-graph", outputBlock: destination });
const context = new NodeAssetContext(asset);
context.setInput(graph.head, document);
const result = await asset.executeAsync(context);
```

`serializeGraph(blocks, { defaults: true })` includes every configuration key;
by default it omits keys whose values equal their defaults. Blocks must be in
dependency order. Serialization preserves connections, not block names or
caller-assigned IDs; IDs and input references are emitted only for non-previous
sources. Input/output blocks outside the supplied array are not serialized.

Invalid objects, unknown keys/types/versions, invalid configuration, duplicate
IDs, forward/missing references, and graphs with multiple sinks throw
`GraphError`. Its `path` locates the problem (for example,
`blocks[3].config.quality`) and its optional `hint` describes valid values.

# Encoding textures

Use `ResizeTexturesBlock({ maxSize: 2048, slots: "all" })` before
`EncodeTexturesBlock({ format: "webp", quality: 80, slots: "all" })`.
Resizing fits the longer side without upscaling and preserves JPEG, PNG, or
WebP format. Encoding accepts JPEG, PNG, WebP, AVIF, and supported 2D ETC1S/UASTC
KTX2 images, with targets `webp`,
`avif`, `jpeg`, or `png`. Quality is an integer from 1 to 100, passed unchanged
to the encoder and ignored for PNG. JPEG falls back to PNG for non-opaque alpha.

`slots` selects `all`, `color`, or `data`. Slots that hold sRGB color (base color,
emissive, diffuse, specular-glossiness, sheen color, and specular color) count as
color; all other slots count as data.
Textures shared by color and data slots remain unchanged. `all` also includes
unused textures. KTX2 is decoded to RGBA using its highest-resolution mip level.
Larger encodes are discarded, except when converting WebP, AVIF, or KTX2 to
JPEG/PNG for compatibility. Image URI extensions and required
`EXT_texture_webp`/`EXT_texture_avif`/`KHR_texture_basisu` declarations follow the
resulting formats.
AVIF processing requires the Node codec (Sharp); the browser codec rejects it.

# Example: Compressing GLB

Same as before, but now add KTX2 texture encoding and Draco geometry encoding.

```ts
const source = new GltfInputBlock({ input: "https://assets.babylonjs.com/meshes/box.glb" });
const encodeTextures = new EncodeKTX2Block();
const encodeGeometry = new EncodeDracoBlock();
const destination = new GltfOutputBlock();

source.output.connectTo(encodeTextures.input);
encodeTextures.output.connectTo(encodeGeometry.input);
encodeGeometry.output.connectTo(destination.input);

const asset = new NodeAsset({
    name: "gltf-roundtrip",
    outputBlock: destination,
});

const result = await asset.executeAsync();
```

# Encoding KTX2 textures

`EncodeKTX2Block` defaults to `mode: "auto"`, `slots: "all"`,
`etc1sQuality: 150`, `uastcQuality: 2`, and `zstd: true`. Auto mode infers encoding
from material usage for JPEG/PNG/WebP inputs (AVIF remains unchanged):

- Color textures use ETC1S with an sRGB transfer function.
- Normal and other data textures use UASTC with a linear transfer function.
- Unused textures default to UASTC and linear.
- Legacy specular/glossiness slots retain their existing data-texture treatment;
  use `MetalRoughBlock` first to convert those materials.
- Textures shared across color, normal, or other data categories remain unchanged.

Set `mode: "etc1s"` or `"uastc"` to override the compression mode without changing
the inferred transfer function. `slots` selects `all`, `color`, or `data`.
`etc1sQuality` ranges from 1 to 255, `uastcQuality` from 0 to 4, and `zstd`
controls supercompression only for UASTC.

# Creating blocks

```ts
const source = new GltfInputBlock({
    input: "box.glb",
});
const destination = new GltfOutputBlock();
```

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

Use one context per set of inputs.

```ts
...

const first = new NodeAssetContext(asset);
first.setInput(source, "https://assets.babylonjs.com/meshes/box.glb");

const second = new NodeAssetContext(asset);
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
