# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

`@babylonjs/node-assets` is an experimental TypeScript library for reading many 3D source formats and producing web-ready formats. The package targets Node and browser environments and bundles all required converters and compressors.

## Getting started

Read [[CONTRIBUTING.md]] for setup and scripts.

## API and coding conventions

- Design the public API as a class-based node graph in the style of Babylon.js node systems.
- Use name-first constructors. Configure instances by assigning properties after construction.
- Add the `Async` suffix to methods that return promises.
- Use camelCase filenames.
- Route all public exports through the single package barrel in `src/index.ts`.
- Keep modules free of side effects: use lazy initialization and do not auto-register at module load time.
- On public types, mark internal members with `@internal` and prefix them with an underscore.
- Throw plain `Error` instances with verbose, static messages. Do not add custom error subclasses or error codes.
- Prefer Babylon.js helpers before reimplementing functionality. Document the reason whenever a helper does not work for this package.

## Comments

- Comments must earn their place by clarifying behavior or intent.
- Use single-line comments unless JSDoc is required for a public API.
- Never restate the code or nearby documentation.

## Tests

Tests live in `tests/` and run in Node via Vitest.

The library is intended to behave identically in Node and the browser. Tests use a single Node project. WebAssembly and worker loading differ between the runtimes for Draco, Meshopt, and KTX2. When the bundled converters and compressors are implemented, add browser coverage as a separate Playwright project rather than through Vitest's browser mode.

## Style

- Prettier and ESLint define formatting. Use `pnpm format` rather than manual formatting.
- Use short, conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`, ...).

## Pull requests

- Keep changes scoped to the task.
- Add a test for any bug you fix and any behavior you add.
- Describe the change and its rationale. Link a related issue when one exists.
