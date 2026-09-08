# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

`@babylonjs/node-assets` is an experimental TypeScript library for reading many 3D source formats and producing web-ready formats. The package targets Node and browser environments and bundles all required converters and compressors.

## Getting started

- Read [[CONTRIBUTING.md]] for setup and scripts.
- Read [[docs/usage.md]] for intended behavior contracts.

## Guidelines

- Avoid heavy OOP overhead where data-oriented design or flat arrays would serve buffer transfers better.
- **Goal first, then code.** Understand the requirements, the performance implications, the math needed, pseudocode, etc. before implementing a solution. Then, write the minimum code that produces identical results.
- **Zero module-level side effects.** No module may execute code at import time.
- **Opt-in features pay for themselves at their enabler.** A feature that must be explicitly enabled (compressions, capture hooks, diagnostics) owns _all_ of its code behind the enable function. Modules that merely _feed_ the feature must contain no feature semantics — no metadata encoding, no branching on feature state, no imports of feature modules.

## Planning

- To propose a feature, first update or add the smallest task-focused guide, section, or note in [[docs/usage.md]].

## Style

- Prettier and ESLint define formatting; use `pnpm format`.
- Add comments only when clarification is needed. Add JSDoc only for public API.
- Use `@internal` JSDoc tag for public API that is not meant for public use.

# Testing

Tests live in `tests/` and run in Node via Vitest.

- Use unit tests for targeted API testing.
- Use integration tests for testing API as a whole.
- Use e2e tests for testing input/output of the executed asset pipeline.
- Don't test error messages. Simple `toThrow()` or `toThrowError()` checks will suffice.
- Don't test implementation details (e.g., private methods, internal state, helpers only used by us etc.). (Exception: if we plan to expose an internal API in the future, we can test it now.)
- Avoid `toHaveBeenCalled()` checks; that is testing implementation details.
- Don't test low-confidence API contracts. If a contract is not documented and/or undefined behavior, ask the user to document it instead.
