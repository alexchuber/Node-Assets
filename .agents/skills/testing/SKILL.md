---
name: testing
description: Test your changes to Node-Assets with Vitest, Playwright, and Babylon.js
---

# Do's and Don'ts

## Do...

- Use unit tests for targeted API testing.
- Use integration tests for testing API as a whole.
- Use e2e tests for testing input/output of the executed asset pipeline.
- Update relevant unit tests if we ever change the public API.

## Don't...

- Don't test implementation details (e.g., private methods, internal state, helpers only used by us etc.). (Exception: if we plan to expose an internal API in the future, we can test it now.)
- Don't test error messages. Leave error checking at `toThrow()` or `toThrowError()`.
- Don't test cases for the sake of testing. If a case is not relevant to the public API, don't test it.

## Future explorations

Non-functional tests to be considered in the future:

- `toMatchSnapshot` for regression testing of lossless asset pipelines.
- `vitest/browser-playwright` for visual regression testing of lossy asset pipelines.
- Bundle size tests to ensure that the Node-Assets package is not larger than expected.

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
