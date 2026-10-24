# List of Blocks

> **Uses** lists a block's implementation dependencies: libraries, functions, modules, and instances. These may include execution-scoped resources.

## Inputs

- `FbxInputBlock`
    - Input: `string` HTTP(S) or data URL, or a Node filesystem path/file URL, pointing to an FBX file.
    - Output: `Document`
    - Uses: Babylon FBX loader
    - Behavior: Uses the Babylon scene loader to load an FBX using NullEngine, exports it as a GLB, then reimports the bytes as a `Document`.
- `GltfInputBlock`
    - Input: `string` URI accepted by the current `PlatformIO`, or a Node filesystem path/file URL, pointing to a glTF or GLB.
    - Output: `Document`
    - Behavior: Reads glTF or GLB into a `Document`, using glTF Transform's default extension handling.
- `ObjInputBlock`
    - Input: `string` HTTP(S) or data URL, or a Node filesystem path/file URL, pointing to an OBJ file.
    - Output: `Document`
    - Uses: Babylon OBJ loader
    - Behavior: Uses the Babylon scene loader to load an OBJ using NullEngine, exports it as a GLB, then reimports the bytes as a `Document`.
- `StlInputBlock`
    - Input: `string` HTTP(S) or data URL, or a Node filesystem path/file URL, pointing to an STL file.
    - Output: `Document`
    - Uses: Babylon STL loader
    - Behavior: Uses the Babylon scene loader to load an STL using NullEngine, exports it as a GLB, then reimports the bytes as a `Document`.
- `UsdInputBlock`
    - Input: `string` HTTP(S) or data URL, or a Node filesystem path/file URL, pointing to a USD, USDA, USDC, or USDZ file.
    - Output: `Document`
    - Uses: Babylon USD loader and the packaged OpenUSD importer runtime; requires Web Worker support.
    - Behavior: Uses the Babylon scene loader to load USD using NullEngine, exports it as a GLB, then reimports the bytes as a `Document`.

# Transforms

For `ResizeTexturesBlock` and `EncodeTexturesBlock`, slots that hold sRGB color
(base color, emissive, diffuse, specular-glossiness, sheen color, and specular color)
count as color; all other slots count as data.

- `StripMaterialsBlock`
    - Input: `Document`
    - Output: `Document`
    - Uses: glTF Transform document graph
    - Behavior: Strips materials, assignments, and newly unused textures.
- `CullUnusedBlock`
    - Input: `Document`
    - Output: the same `Document`
    - Uses: glTF Transform `prune()`
    - Behavior: Removes unused document resources with library-default behavior.
- `QuantizeBlock`
    - Input: `Document`
    - Output: the same `Document`
    - Uses: glTF Transform `quantize()`; execution-scoped `PlatformIO`
    - Behavior: Quantizes mesh attributes with library-default behavior.
- `DedupBlock` (`transform.dedup`)
    - Input/output: the same `Document`
    - Uses: glTF Transform `dedup()`
    - Behavior: Deduplicates resources with library-default behavior. No config.
- `WeldBlock` (`transform.weld`)
    - Input/output: the same `Document`
    - Uses: glTF Transform `weld()`
    - Behavior: Merges bitwise-identical vertices with library-default behavior. No config.
- `MetalRoughBlock` (`transform.metal-rough`)
    - Input/output: the same `Document`
    - Uses: glTF Transform `metalRough()`; execution-scoped `PlatformIO`
    - Behavior: Converts `KHR_materials_pbrSpecularGlossiness` to metal/rough, registering the resulting IOR/specular extensions for output; no-op without the source extension. No config.
- `FlattenBlock` (`transform.flatten`)
    - Input/output: the same `Document`
    - Uses: glTF Transform `flatten()`
    - Behavior: Flattens the scene hierarchy; no-op if any animations or skins exist. No config.
- `InstanceBlock` (`transform.instance`)
    - Input/output: the same `Document`
    - Uses: glTF Transform `instance()`; execution-scoped `PlatformIO`
    - Config: `min` (positive integer, default 5).
    - Behavior: Instances shared meshes with `EXT_mesh_gpu_instancing`; registers the extension for output.
- `SimplifyBlock` (`transform.simplify`)
    - Input/output: the same `Document`
    - Uses: glTF Transform `simplify()`; execution-scoped `MeshoptSimplifierResource`
    - Config: `ratio` (0–1, default 0), `error` (nonnegative finite number, default 0.0001), `lockBorder` (boolean, default false).
    - Behavior: Simplifies triangle geometry. The library welds unindexed primitives internally (`overwrite: false`); an explicit `WeldBlock` can also merge duplicates in indexed geometry.
- `ResizeTexturesBlock` (`transform.resize-textures`)
    - Input/output: the same `Document`
    - Uses: `RasterImageCodecResource.resizeAsync()`
    - Config: `maxSize` (integer 1–16384, default 2048), `slots` (`all|color|data`, default `all`).
    - Behavior: Fits JPEG/PNG/WebP images to the maximum longer side without upscaling or changing format. Skips mixed color/data textures.
- `EncodeTexturesBlock` (`transform.encode-textures`)
    - Input/output: the same `Document`
    - Uses: `RasterImageCodecResource`; execution-scoped `PlatformIO`
    - Config: `format` (`webp|avif|jpeg|png`, default `webp`), `quality` (integer 1–100, default 80), `slots` (`all|color|data`, default `all`).
    - Behavior: Encodes JPEG/PNG/WebP/AVIF; preserves smaller originals unless converting extension formats to JPEG/PNG for compatibility. JPEG with transparency becomes PNG. Skips mixed color/data textures; `all` includes unused textures. Updates image URI extensions and required WebP/AVIF declarations. AVIF requires Node/Sharp.
- `ValidateBlock`
    - Input: `Document`
    - Output: the same `Document`
    - Uses: `gltf-validator`; execution-scoped `PlatformIO`
    - Behavior: Validates the document, throwing on errors and logging other issues. Ignores `UNSUPPORTED_EXTENSION`.
- `EncodeKTX2Block`
    - Input: `Document`
    - Output: `Document` (but in future should be type that locks images and/or textures)
    - Uses: `RasterImageCodecResource`, `KTX2EncoderResource`, and `PlatformIOResource`
    - Behavior: Compresses JPEG/PNG/WebP textures to KTX2, inferring encoding from material usage. Preserves legacy specular/glossiness data treatment and leaves AVIF unchanged.
    - Config: `mode` (`auto|etc1s|uastc`, default `auto`), `slots` (`all|color|data`, default `all`), `etc1sQuality` (integer 1–255, default 150), `uastcQuality` (integer 0–4, default 2), `zstd` (boolean, default true; UASTC only).
- `EncodeDracoBlock`
    - Input: `Document`
    - Output: `Document` (but in future should be type that locks geometry)
    - Uses: initialized `EncoderModule` (`draco3dgltf`)
    - Behavior: Uses glTF Transform's Draco compression behavior with library-default tuning.
    - Config: `method` (`edgebreaker|sequential`, default `edgebreaker`), `encodeSpeed` and `decodeSpeed` (integers 0–10, defaults 5), `quantizePosition` (default 14), `quantizeNormal` (10), `quantizeColor` (8), `quantizeTexcoord` (12), `quantizeGeneric` (12). Quantization values are integers 1–30.
- `EncodeMeshoptBlock`
    - Input: `Document`
    - Output: `Document` (but in future should be type that locks geometry)
    - Uses: `MeshoptEncoder` (`meshoptimizer`)
    - Behavior: Uses glTF Transform's Meshopt compression behavior with library-default tuning.
    - Config: `level` (`medium|high`, default `high`).

# Outputs

- `GltfOutputBlock`
    - Inputs: `Document`
    - Output: `File` which is a GLB
    - Behavior: Create GLB bytes.
