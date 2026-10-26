import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getIOAsync, readDocAsync } from "../../packages/cli/src/document";
import { inputBytesAsync, inputHashAsync, loadBytesAsync } from "../../packages/cli/src/inputs";
import { extensionsOf } from "../../packages/cli/src/measure";
import { EncodeDracoBlock, NodeAsset } from "../../packages/core/src/index";
import { createGridDocument } from "../helpers/document";

describe("CLI input resources", () => {
    let directory: string;
    beforeAll(async () => {
        directory = resolve(`_cli-inputs-${randomUUID()}`);
        await mkdir(directory);
    });
    afterAll(async () => {
        if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("includes OBJ material and texture bytes in input hashes", async () => {
        const obj = join(directory, "model.obj");
        const mtl = join(directory, "model.mtl");
        const texture = join(directory, "texture.png");
        const source = "mtllib model.mtl\n";
        const material = "newmtl material\nmap_Kd texture.png\n";
        await writeFile(obj, source);
        await writeFile(mtl, material);
        await writeFile(texture, new Uint8Array([1, 2, 3]));
        expect(await inputBytesAsync(obj)).toBe(source.length + material.length + 3);
        const before = await inputHashAsync(obj);
        await writeFile(texture, new Uint8Array([3, 2, 1]));
        expect(await inputHashAsync(obj)).not.toBe(before);
    });

    it("includes uppercase MTL texture directives in byte counts and hashes", async () => {
        const cwd = join(directory, "uppercase");
        await mkdir(cwd);
        const obj = join(cwd, "model.obj");
        const source = "mtllib model.mtl\n";
        const material = "newmtl material\nMAP_KD texture.png\n";
        await writeFile(obj, source);
        await writeFile(join(cwd, "model.mtl"), material);
        const texture = join(cwd, "texture.png");
        await writeFile(texture, new Uint8Array([1, 2, 3]));
        expect(await inputBytesAsync(obj)).toBe(source.length + material.length + 3);
        const before = await inputHashAsync(obj);
        await writeFile(texture, new Uint8Array([3, 2, 1]));
        expect(await inputHashAsync(obj)).not.toBe(before);
    });

    it("resolves MTL textures relative to the OBJ when the material is in a subdirectory", async () => {
        const cwd = join(directory, "subdirectory");
        await mkdir(join(cwd, "materials"), { recursive: true });
        const obj = join(cwd, "model.obj");
        const source = "mtllib materials/model.mtl\n";
        const material = "newmtl material\nmap_Kd texture.png\n";
        await writeFile(obj, source);
        await writeFile(join(cwd, "materials/model.mtl"), material);
        await writeFile(join(cwd, "materials/texture.png"), new Uint8Array([9]));
        const texture = join(cwd, "texture.png");
        await writeFile(texture, new Uint8Array([1, 2, 3]));
        expect(await inputBytesAsync(obj)).toBe(source.length + material.length + 3);
        const before = await inputHashAsync(obj);
        await writeFile(texture, new Uint8Array([3, 2, 1]));
        expect(await inputHashAsync(obj)).not.toBe(before);
    });

    it("strips inline OBJ and MTL comments when discovering resources", async () => {
        const cwd = join(directory, "comments");
        await mkdir(cwd);
        const obj = join(cwd, "model.obj");
        const source = "mtllib model.mtl # material file\n";
        const material = "newmtl material\nmap_Kd texture.png # diffuse texture\n";
        await writeFile(obj, source);
        await writeFile(join(cwd, "model.mtl"), material);
        const texture = join(cwd, "texture.png");
        await writeFile(texture, new Uint8Array([1, 2, 3]));
        expect(await inputBytesAsync(obj)).toBe(source.length + material.length + 3);
        const before = await inputHashAsync(obj);
        await writeFile(texture, new Uint8Array([3, 2, 1]));
        expect(await inputHashAsync(obj)).not.toBe(before);
    });

    it("skips missing referenced files and continues accounting for available resources", async () => {
        const cwd = join(directory, "missing-resources");
        await mkdir(cwd);
        const obj = join(cwd, "model.obj");
        const source = "mtllib missing.mtl\nmtllib present.mtl\n";
        const material = "newmtl material\nmap_Kd missing.png\nmap_Ks present.png\n";
        await writeFile(obj, source);
        await writeFile(join(cwd, "present.mtl"), material);
        const texture = join(cwd, "present.png");
        await writeFile(texture, new Uint8Array([1, 2, 3]));
        expect(await inputBytesAsync(obj)).toBe(source.length + material.length + 3);
        const before = await inputHashAsync(obj);
        await writeFile(texture, new Uint8Array([3, 2, 1]));
        expect(await inputHashAsync(obj)).not.toBe(before);
    });

    it("preserves decoder metadata when embedding a glTF and its resources", async () => {
        const block = new EncodeDracoBlock({ input: createGridDocument(1) });
        const asset = new NodeAsset({ name: "input-draco", outputBlock: block });
        try {
            const doc = await asset.executeAsync();
            const path = join(directory, "compressed.gltf");
            await (await getIOAsync()).write(path, doc);
            const decoded = await readDocAsync(await loadBytesAsync(path));
            expect(extensionsOf(decoded).decoders).toEqual(["draco"]);
        } finally {
            asset.dispose();
        }
    });

    it("maps malformed glTF to INVALID_INPUT", async () => {
        const file = join(directory, "corrupt.gltf");
        await writeFile(file, "invalid");
        await expect(loadBytesAsync(file)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });
});
