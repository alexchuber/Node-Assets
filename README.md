# Node Assets

A graph-based system for preparing 3D assets for the web.

> **⚠️ Notice:** This package is experimental. API is subject to change and not intended for production use.

## Prerequisites

- **Node.js** ≥ 20.19
- **pnpm** ≥ 9

## Getting Started

```bash
pnpm install
pnpm build
```

## Scripts

| Command                 | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `pnpm build`            | Build the package                                   |
| `pnpm lint`             | Run ESLint and TypeScript type checking             |
| `pnpm format`           | Format source, test, and config files with Prettier |
| `pnpm test`             | Run the complete Vitest suite                       |
| `pnpm test:unit`        | Run hermetic unit tests                             |
| `pnpm test:integration` | Run the live CDN integration tests                  |
| `pnpm run docs`         | Generate TypeDoc API documentation                  |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
