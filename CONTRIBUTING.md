# Contributing

Because this package is still early in development, please open a discussion on the [Babylon.js forum](https://forum.babylonjs.com/t/node-assets-requesting-feedback-discussion/63877) about your feature request before starting any work.

## Prerequisites

This repo uses [pnpm](https://pnpm.io/). The required Node and pnpm versions are declared in
`package.json` (`engines` and `packageManager`).

## Getting Started

```bash
pnpm install
pnpm build
```

The `packages/core` workspace contains the `@babylonjs/node-assets` library.
`packages/cli` contains the private `node-assets-cli` package. Its build copies
the core distribution into its own distribution so packed installs are standalone.
Build both before running the local CLI:

```sh
pnpm cli inspect model.glb
pnpm cli run optimize model.glb -o public/model.glb
pnpm cli show optimize
pnpm cli help
```

## Scripts

```sh
pnpm lint          # ESLint, Prettier, and typecheck
pnpm lint:fix      # ESLint autofix
pnpm format        # Write Prettier formatting
pnpm test          # Run Vitest
pnpm test:watch    # Run Vitest in watch mode
pnpm build         # Build the library, then the CLI
pnpm build:core    # Build only the library into packages/core/dist/
pnpm cli           # Show models and graphs under the current directory
pnpm typedocs      # Generate the TypeDoc API reference
```

The shared lint, format, and typecheck commands cover both packages. CLI tests
live in `tests/e2e/cli.test.ts` and build isolated package fixtures. Build first,
then run only the focused file:

```sh
pnpm vitest run tests/e2e/cli.test.ts
```

The [node-assets manual](packages/cli/docs/node-assets.1.md) defines commands,
flags, TOON output, graph files and error codes. `pnpm cli <command> --help`
prints a concise command reference. `tune`, `run --check`, and `inspect --against`
need a Chromium browser; other commands do not. For example,
`pnpm cli tune model.glb --for size,gpu -o graphs/` writes reusable graphs and
side-by-side previews without writing models.

Make sure you've run `pnpm lint`, `pnpm test`, and `pnpm build` before opening a pull request.
