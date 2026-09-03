# Convert between formats

**Status: Planned**

Connect format-specific blocks. The compiler must insert the mechanical conversions between compatible scene domains.

```ts
import { CenterBlock, GLTFOutputBlock, NodeAsset, USDInputBlock } from "@babylonjs/node-assets";

const source = new USDInputBlock({ input: usdBytes });
const center = new CenterBlock();
const destination = new GLTFOutputBlock({ binary: true });

source.output.connectTo(center.input);
center.output.connectTo(destination.input);

const asset = new NodeAsset({
    name: "usd-to-glb",
    outputBlock: destination,
});
const result = await asset.executeAsync();
```

The visible graph is:

```text
USD input -> Center -> GLB output
```

Before execution, the compiler must expand format boundaries and compound blocks into primitive steps:

```text
USD input
  -> USD to USD stage
  -> USD transforms
  -> USD to glTF
  -> glTF to Babylon scene
  -> Center
  -> Babylon scene to glTF
  -> Apply GLB profile
  -> GLB output
```

Expansion must preserve type checks, caching, diagnostics, progress, and tracing. Only steps that contribute to an output may execute.
