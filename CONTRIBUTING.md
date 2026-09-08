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

## Scripts

```sh
pnpm lint          # ESLint, Prettier, and typecheck
pnpm lint:fix      # ESLint autofix
pnpm format        # Write Prettier formatting
pnpm test          # Run Vitest
pnpm test:watch    # Run Vitest in watch mode
pnpm build         # Build with Vite and emit dist/
pnpm typedocs      # Generate the TypeDoc API reference
```

Make sure you've run `pnpm lint`, `pnpm test`, and `pnpm build` before opening a pull request.
