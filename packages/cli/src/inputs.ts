import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve, sep } from "node:path";

import { FbxInputBlock, GltfInputBlock, GltfOutputBlock, NodeAsset, ObjInputBlock, StlInputBlock, UsdInputBlock } from "@babylonjs/node-assets";

import { getIOAsync, readDocAsync } from "./document";
import { CliError, rel, withDiagnosticsAsync } from "./output";

export const ALL_IN = [".glb", ".gltf", ".fbx", ".obj", ".stl", ".usd", ".usda", ".usdc", ".usdz"] as const;

export function supportedInput(file: string): boolean {
    return (ALL_IN as readonly string[]).includes(extname(file).toLowerCase());
}

export function unsupportedHint(extension: string): string {
    const hints: Record<string, string> = {
        ".blend": "Export it from Blender as .glb (File > Export > glTF 2.0) or .fbx first.",
        ".max": "Export it from 3ds Max as .fbx or .glb first.",
        ".ma": "Export it from Maya as .fbx or .glb first.",
        ".mb": "Export it from Maya as .fbx or .glb first.",
        ".c4d": "Export it from Cinema 4D as .fbx or .glb first.",
        ".dae": "Convert COLLADA to .glb or .fbx first.",
    };
    return hints[extension] ?? `Supported inputs: ${ALL_IN.join(" ")}`;
}

export interface InputItem {
    readonly input: string;
    readonly error?: CliError;
    readonly skip?: string;
}

export async function collectAsync(positionals: readonly string[]): Promise<{ items: InputItem[]; multi: boolean }> {
    const items: InputItem[] = [];
    let multi = positionals.length > 1;
    const auxiliary = [".bin", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ktx2", ".mtl", ".txt", ".md", ".json", ".toon", ".html", ".js", ".css"];
    for (const input of positionals) {
        const entry = await stat(input).catch(() => null);
        if (!entry) {
            items.push({ input, error: new CliError("INPUT_NOT_FOUND", `${input}: no such file or directory`, [`Paths are relative to ${process.cwd()}`]) });
        } else if (entry.isDirectory()) {
            multi = true;
            const files = (await readdir(input, { withFileTypes: true }))
                .filter((file) => file.isFile() && !file.name.startsWith("."))
                .sort((a, b) => a.name.localeCompare(b.name));
            for (const file of files) {
                const path = input + (input.endsWith(sep) ? "" : sep) + file.name;
                const extension = extname(file.name).toLowerCase();
                if (supportedInput(path)) items.push({ input: path });
                else if (!auxiliary.includes(extension))
                    items.push({ input: path, skip: `${extension || "(no extension)"} is not a supported input; ${unsupportedHint(extension)}` });
            }
        } else if (!entry.isFile()) {
            items.push({ input, error: new CliError("INVALID_INPUT", `${input}: not a regular file`) });
        } else items.push({ input });
    }
    return { items, multi };
}

export async function canonicalizeInputsAsync(items: readonly InputItem[]): Promise<(InputItem & { readonly display: string; readonly name: string })[]> {
    return Promise.all(
        items.map(async (item) => {
            const display = isAbsolute(item.input) ? rel(item.input) : item.input;
            const name = basename(item.input);
            if (item.error || item.skip) return { ...item, display, name };
            try {
                return { ...item, input: await realpath(item.input), display, name };
            } catch {
                return { ...item, display, name, error: new CliError("INPUT_NOT_FOUND", `${display}: no readable input file`) };
            }
        })
    );
}

export function inputBlock(file: string) {
    const input = resolve(file);
    const extension = extname(file).toLowerCase();
    switch (extension) {
        case ".glb":
        case ".gltf":
            return new GltfInputBlock({ input });
        case ".fbx":
            return new FbxInputBlock({ input });
        case ".obj":
            return new ObjInputBlock({ input });
        case ".stl":
            return new StlInputBlock({ input });
        case ".usd":
        case ".usda":
        case ".usdc":
        case ".usdz":
            return new UsdInputBlock({ input });
        default:
            throw new CliError("UNSUPPORTED_FORMAT", `${file}: unsupported input format ${extension}`, [unsupportedHint(extension)]);
    }
}

export function invalidInput(error: unknown, file: string): CliError {
    if (error instanceof CliError) return error;
    const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    const hint = /Worker/i.test(message)
        ? "USD input needs Web Worker support: NODE_OPTIONS=--experimental-web-worker"
        : extname(file).toLowerCase() === ".obj" && /mtl/i.test(message)
          ? "Place the referenced .mtl file and textures next to the OBJ"
          : "The file may be corrupt or use unsupported features; re-export it as .glb or .fbx";
    return new CliError("INVALID_INPUT", `${file}: ${message}`, [hint]);
}

export async function loadBytesAsync(file: string): Promise<Uint8Array> {
    if (!(await stat(file).catch(() => null))?.isFile()) throw new CliError("INPUT_NOT_FOUND", `${file}: no such input file`);
    const source = inputBlock(file);
    return withDiagnosticsAsync(async () => {
        try {
            if (extname(file).toLowerCase() === ".glb") {
                const bytes = new Uint8Array(await readFile(file));
                await readDocAsync(bytes);
                return bytes;
            }
            if (extname(file).toLowerCase() === ".gltf") {
                const io = await getIOAsync();
                return await io.writeBinary(await io.read(resolve(file)));
            }
            const destination = new GltfOutputBlock();
            source.output.connectTo(destination.input);
            const asset = new NodeAsset({ name: "convert", outputBlock: destination });
            try {
                return new Uint8Array(await (await asset.executeAsync()).arrayBuffer());
            } finally {
                asset.dispose();
            }
        } catch (error) {
            throw invalidInput(error, file);
        }
    });
}

async function inputFilesAsync(file: string): Promise<string[]> {
    const files = new Set([resolve(file)]);
    const directory = dirname(resolve(file));
    const addURI = (uri: string) => {
        if (/^data:/i.test(uri)) return;
        if (/^[a-z][a-z\d+.-]*:/i.test(uri) || isAbsolute(uri)) throw new CliError("INVALID_INPUT", `${file}: referenced resources must be local relative paths`);
        files.add(resolve(directory, decodeURIComponent(uri)));
    };
    try {
        if (extname(file).toLowerCase() === ".gltf") {
            const json = JSON.parse(await readFile(file, "utf8")) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
            for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) if (resource.uri) addURI(resource.uri);
        } else if (extname(file).toLowerCase() === ".obj") {
            const text = (await readFile(file, "utf8")).replace(/#.*$/gm, "");
            for (const match of text.matchAll(/^\s*mtllib\s+(.+)$/gim)) {
                const material = resolve(directory, match[1]!.trim());
                files.add(material);
                const contents = (await readFile(material, "utf8").catch(() => "")).replace(/#.*$/gm, "");
                for (const map of contents.matchAll(/^\s*(?:map_\w+|bump|disp|decal|norm)\s+(.+)$/gim)) {
                    addURI(map[1]!.trim().replace(/^(?:-\w+\s+(?:-?\d+(?:\.\d+)?\s+)+)+/, ""));
                }
            }
        }
    } catch (error) {
        throw invalidInput(error, file);
    }
    return [...files];
}

export async function inputBytesAsync(file: string): Promise<number> {
    try {
        const source = resolve(file);
        const sizes = await Promise.all(
            (await inputFilesAsync(file)).map(async (path) => {
                const entry = await stat(path).catch((error: unknown) => {
                    if (path === source) throw error;
                    return null;
                });
                return entry?.size ?? 0;
            })
        );
        return sizes.reduce((total, size) => total + size, 0);
    } catch (error) {
        throw invalidInput(error, file);
    }
}

export async function inputHashAsync(file: string): Promise<string> {
    const hash = createHash("sha1");
    try {
        const source = resolve(file);
        for (const path of await inputFilesAsync(file)) {
            const bytes = await readFile(path).catch((error: unknown) => {
                if (path === source) throw error;
                return undefined;
            });
            if (bytes) hash.update(bytes);
        }
        return hash.digest("hex").slice(0, 12);
    } catch (error) {
        throw invalidInput(error, file);
    }
}
