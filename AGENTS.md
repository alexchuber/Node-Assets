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
    - Gotcha: Module-level `const cache = new Map()` **kills tree-shaking** — the bundler treats the allocation as a side-effect and cannot eliminate the module even when nothing is imported from it. Use lazy-init instead: `let cache: Map | null = null; function getCache() { if (!cache) cache = new Map(); return cache; }`. Typed-array constants (`new Float32Array([...])`) are safe — bundlers treat them as pure.
    - **Never pass a branch-gating object to an optional seam — pass the already-computed scalar.** This is about the _runtime value_, not the type annotation (types are erased and cost nothing). Rollup tracks the property values of object literals and uses them to prove branches dead. Handing such an object to an unknown callee (`engine._dlr?.x(bgOptions)`) forces Rollup to **deoptimize** it — the callee might mutate it — so it loses the known property values and keeps branches it would otherwise have eliminated, including the `await import()` inside them. Passing an _unrelated_ object is harmless — the hazard is specifically an object whose properties gate tree-shakeable code.
- **Opt-in features pay for themselves at their enabler.** A feature that must be explicitly enabled (compressions, capture hooks, diagnostics) owns _all_ of its code behind the enable function. Modules that merely _feed_ the feature must contain no feature semantics — no metadata encoding, no branching on feature state, no imports of feature modules.

## Target API shape

```typescript
// asset-pipeline.ts
import {} from "@babylonjs/node-assets";

// resources (codecs, workers) -> coordinator (injects)?
const coordinator = new AssetGraphCoordinator({ scene });

// changing instructions -> change graphs
const graph = coordinator.createGraph();

// changing inputs -> change contexts
// Then, we will create the contexts and set the needed variables:
const potatoContext = graph.createContext();
potatoContext.setVariable("vegetable", "potato");
potatoContext.setVariable("cutType", "slices");

const carrotContext = graph.createContext();
carrotContext.setVariable("vegetable", "carrot");
carrotContext.setVariable("cutType", "sticks");

// Now, we will create the blocks:

// data (input) blocks
const getVegetableBlock = new GetVariableBlock({ variableName: "vegetable" });
const getCutTypeBlock = new GetVariableBlock({ variableName: "cutType" });

// execution blocks
const rinseBlock = new RinseBlock();
rinseBlock.vegetableToRinse.connectTo(getVegetableBlock);
// using a value directly, on each of the contexts
rinseBlock.useSoap.setValue(true, potatoContext);
rinseBlock.useSoap.setValue(false, carrotContext);

const cutBlock = new CutBlock();
cutBlock.rinsedVegetable.connectTo(rinseBlock.rinsedVegetable); // connect the two blocks using a data connection
cutBlock.cutType.connectTo(getCutTypeBlock);
// trigger cut when done rinsing
rinseBlock.doneRinsing.connectTo(cutBlock.startCutting);

const fryBlock = new FryBlock();
fryBlock.cutVegetable.connectTo(cutBlock.cutVegetable); // connect the two blocks using a data connection

// now the event block
const startCookingBlock = new StartCookingBlock();
graph.addEventBlock(startCookingBlock);

// Now the graph will be executed twice -- once for a potato and once for a carrot. We are still missing a few things (which you can think about how to implement yourself):

graph.start();
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
[Babylon Transforms]
     │ SceneRef<"babylon">
[GLB Output] ◀── ExportProfile<"glb">
     │ ArtifactRef<"glb">
```

The expanded execution graph remains explicit:

```
[USD Input]
  → [USD → glTF]
  → [glTF → Babylon Scene]
  → [Babylon Transforms]
  → [Babylon → glTF]
  → [Apply GLB Profile]
  → [GLB Output]
```

`To Babylon Scene` and `GLB Output` are compound blocks. The compiler expands them before execution so caching, diagnostics, progress, and tracing still operate on primitive blocks.

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
