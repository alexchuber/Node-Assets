# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

`@babylonjs/node-assets` is an experimental TypeScript library for reading many 3D source formats and producing web-ready formats. The package targets Node and browser environments and bundles all required converters and compressors.

## Getting started

Read [[CONTRIBUTING.md]] for setup and scripts.

## Guidelines

- Avoid heavy OOP overhead where data-oriented design or flat arrays serve GPU buffer transfers better.
- **Do NOT copy code.** Understand the math, then write the minimum code that produces identical results.
- **Bundle size = runtime bytes only.** The bundle size tests measure JS bytes actually fetched at runtime via Playwright network interception, and distinguish between our own runtime code vs. bundled third-party modules or WASMs. Dynamic-import chunks that are not loaded (e.g. animation-group for a static model, pbr-reflectance-ext when no reflectance textures) are correctly excluded. Unused chunks in the build output are fine — only fetched counted bytes matter.
- **Zero module-level side effects.** No module may execute code at import time.
    - **Never pass a branch-gating object to an optional seam — pass the already-computed scalar.** This is about the _runtime value_, not the type annotation (types are erased and cost nothing). Rollup tracks the property values of object literals and uses them to prove branches dead. Handing such an object to an unknown callee (`engine._dlr?.x(bgOptions)`) forces Rollup to **deoptimize** it — the callee might mutate it — so it loses the known property values and keeps branches it would otherwise have eliminated, including the `await import()` inside them. Passing an _unrelated_ object is harmless — the hazard is specifically an object whose properties gate tree-shakeable code.
- **Opt-in features pay for themselves at their enabler.** A feature that must be explicitly enabled (compressions, capture hooks, diagnostics) owns _all_ of its code behind the enable function. Modules that merely _feed_ the feature must contain no feature semantics — no metadata encoding, no branching on feature state, no imports of feature modules.

## Target API shapes

## Target API shape

```
const usd = new AssetInputBlock("model/usd");

const glb = new AssetOutputBlock("model/gltf-binary");

usd.output.connectTo(glb.input);

const graph = new AssetGraph()

const ctx = graph.createContext();
```

## Target graph shape

The normal authoring view should hide mechanical conversions:

```
[USD Input]
     │ SceneRef<"usd">
[USD Stage Transforms]
     │ SceneRef<"usd">
[To Babylon Scene]
     │ SceneRef<"babylon">
[Babylon Transforms] ◀── Selection<"glb">
     │ SceneRef<"babylon">
[GLB Output] ◀── ExportProfile<"glb">
     │ ArtifactRef<"glb">
```

The expanded execution graph remains explicit:

```
[USD Input] // -> ArtifactRef<"usd">
  → [USD → USD Stage] // ArtifactRef<"usd"> -> SceneRef<"usd">             // Parse
  → [USD Transforms] // SceneRef<"usd"> -> SceneRef<"usd">
  → [USD → glTF] // SceneRef<"usd"> -> ArtifactRef<"gltf">                 // Serialize
  → [glTF → Babylon Scene] // ArtifactRef<"gltf"> -> SceneRef<"babylon">   // Parse
  → [Babylon Transforms] // SceneRef<"babylon"> -> SceneRef<"babylon">
  → [Babylon → glTF] // SceneRef<"babylon"> -> ArtifactRef<"gltf">         // Serialize
  → [GLB Output] // ArtifactRef<"gltf"> ->
     → [GLB Profile] // ExportProfile<"gltf"> ->
```

`To Babylon Scene` and `GLB Output` are compound blocks. The compiler expands them before execution so caching, diagnostics, progress, and tracing still operate on primitive blocks.

## Core runtime types

interface SceneRef<Domain extends string> {
readonly kind: "scene";
readonly domain: Domain;
readonly id: string;
readonly revision: number;
readonly contentHash?: string;
}

interface ArtifactRef<Format extends string> {
readonly kind: "artifact";
readonly format: Format;
=}

interface Selector<Domain extends string, AssetKind extends string> {
readonly domain: Domain;
readonly assetKind: AssetKind;
readonly expression: unknown;
}

interface ExportRule<Format extends string, AssetKind extends string> {
readonly format: Format;
readonly assetKind: AssetKind;
readonly settings: unknown;
}

interface ExportProfile<Format extends string> {
readonly format: Format;
readonly rules: readonly ExportRule<Format, string>[];
}

## Graph execution

```
public run(inputs: Inputs): Output {
    const context = new ExecutionContext(inputs);
    try {
        this._execute(context);
        return context.takeOutput();
    } finally {
        context.dispose();
    }
}

```

Isolate each invocation** and clean intermediate memory deterministically. `takeOutput()` explicitly transfers the final resource to the caller; the context disposes everything else. I would not expose the context unless callers need debugging, incremental execution, or multiple outputs.

## Tests

Tests live in `tests/` and run in Node via Vitest.

## Style

- Prettier and ESLint define formatting. Use `pnpm format` rather than manual formatting.
- Use functional, immutable patterns.
- Add comments only when clarification is needed. Add JSDoc only for public API.
- Use short, conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`, ...).

## Pull requests

- Keep changes scoped to the task.
- Add a test for any bug you fix and any behavior you add.
- Describe the change and its rationale. Link a related issue when one exists.

# Target directory structure

```
tests/
     shared/
          assets/
               box.glb
          fixtures/
               export-box.ts // load box.glb; export
     visual/
          references/
               export-box-roundtrip.png
          harness/
               viewer/
                    index.html
                    viewer.mjs
               roundtrip.mjs
          visual.spec.ts
     integration/
          integration.spec.ts // pipelines run without errors or invalid outputs
          validation.spec.ts // outputs are valid GLBs
     visual.spec.ts // roundtripped outputs look good
```

asset-size.spec.ts // outputs are expected size

// import { playwright } from '@vitest/browser-playwright'

```
// export-box.spec.ts

import { exportGlb } from "../../../src/index.js";

const boxUrl = new URL("../../assets/box.glb", import.meta.url);

export default async function createAsset(): Promise<Uint8Array> {
    return exportGlb(boxUrl);
}

const test = baseTest
  .extend('database', { scope: 'file' }, async ({}, { onCleanup }) => {
    const db = await createDatabase()
    onCleanup(() => db.close())
    return db
  })

let result = {
     file: null,
     error: null
}

beforeAll(() => {
     try {
          const file = createAsset();
          result.file = file;
     } catch (e) {
          result.error = e;
     }
});

test("smoke", { tags: ['smoke'] }, () => {
     // verify no errors, the file is there, and it's a valid GLB, and
})


test("asset is valid", { tags: ['validation'] }, () => {
     // verify it's a valid GLB, and
})
```
