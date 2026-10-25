import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseGraph, serializeGraph, type Graph, type SerializedGraph } from "@babylonjs/node-assets";
import { decode } from "@toon-format/toon";

import { writeAtomic } from "./files";
import { asError, CliError, serialize } from "./output";

export interface GraphFile extends SerializedGraph {
    readonly name?: string;
    readonly goal?: string;
    readonly check?: { readonly fidelity: number; readonly view: number };
    readonly tuned?: Readonly<Record<string, unknown>>;
}

export function builtinPath(name = "optimize"): string {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "graphs", `${name}.toon`);
}

function object(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("BAD_GRAPH", `${path}: expected an object`);
    return value as Record<string, unknown>;
}

export function normalizeGraph(value: unknown): GraphFile {
    const source = object(value, "graph");
    const allowed = ["graph", "name", "goal", "blocks", "check", "tuned"];
    for (const key of Object.keys(source)) {
        if (!allowed.includes(key)) throw new CliError("BAD_GRAPH", `${key}: unknown top-level key`, [`Valid top-level keys: ${allowed.join(", ")}`]);
    }
    for (const key of ["name", "goal"]) {
        if (Object.hasOwn(source, key) && typeof source[key] !== "string") throw new CliError("BAD_GRAPH", `${key}: expected a string`);
    }
    let check: GraphFile["check"];
    if (Object.hasOwn(source, "check")) {
        const entry = object(source.check, "check");
        for (const key of Object.keys(entry)) {
            if (!["fidelity", "view"].includes(key)) throw new CliError("BAD_GRAPH", `check.${key}: unknown setting`, ["Valid check settings: fidelity, view"]);
        }
        const fidelity = Object.hasOwn(entry, "fidelity") ? entry.fidelity : 0.9;
        const view = Object.hasOwn(entry, "view") ? entry.view : 1024;
        if (typeof fidelity !== "number" || !Number.isFinite(fidelity) || fidelity < 0 || fidelity > 1) {
            throw new CliError("BAD_GRAPH", "check.fidelity: expected a number from 0 to 1");
        }
        if (typeof view !== "number" || !Number.isInteger(view) || view < 16) throw new CliError("BAD_GRAPH", "check.view: expected an integer of at least 16");
        check = { fidelity, view };
    }
    try {
        const graph = serializeGraph(parseGraph({ graph: source.graph, blocks: source.blocks }).blocks, { defaults: true });
        return {
            ...graph,
            ...(typeof source.name === "string" ? { name: source.name } : {}),
            ...(typeof source.goal === "string" ? { goal: source.goal } : {}),
            ...(check ? { check } : {}),
            ...(Object.hasOwn(source, "tuned") ? { tuned: object(source.tuned, "tuned") } : {}),
        };
    } catch (error) {
        throw asError(error);
    }
}

export function parseGraphFile(text: string): GraphFile {
    let value: unknown;
    try {
        value = decode(text);
    } catch {
        throw new CliError("BAD_GRAPH", "Graph is not valid TOON", ["Check indentation, key: value syntax, and array lengths"]);
    }
    return normalizeGraph(value);
}

export async function readGraph(argument: string): Promise<GraphFile> {
    const isFile = /[/\\]/.test(argument) || argument.endsWith(".toon");
    if (!isFile && argument !== "optimize")
        throw new CliError("BAD_GRAPH", `Unknown built-in graph ${argument}`, ["Built-in graphs: optimize; use a path or .toon extension for a graph file"]);
    const path = isFile ? argument : builtinPath(argument);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch {
        throw new CliError("INPUT_NOT_FOUND", `${path}: no readable graph file`, ["node-assets show optimize > mine.toon"]);
    }
    return parseGraphFile(text);
}

export function instantiateGraph(graph: SerializedGraph): Graph {
    return parseGraph({ graph: graph.graph, blocks: graph.blocks });
}

export function serializeGraphFile(graph: GraphFile): string {
    return serialize(normalizeGraph(graph));
}

export async function writeGraph(file: string, graph: GraphFile): Promise<void> {
    await writeAtomic(file, serializeGraphFile(graph));
}

export function graphHash(graph: SerializedGraph): string {
    return createHash("sha1")
        .update(JSON.stringify(serializeGraph(instantiateGraph(graph).blocks, { defaults: true })))
        .digest("hex")
        .slice(0, 12);
}
