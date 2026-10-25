import type { Block, _BlockRuntime } from "../blocks/block";
import type { _InputBlockDefinition, ConfigDescriptor } from "../blocks/blockDefinition";
import { CullUnusedBlock } from "../blocks/cullUnusedBlock";
import { DedupBlock } from "../blocks/dedupBlock";
import { DequantizeBlock } from "../blocks/dequantizeBlock";
import { EncodeDracoBlock } from "../blocks/encodeDracoBlock";
import { EncodeKTX2Block } from "../blocks/encodeKtx2Block";
import { EncodeMeshoptBlock } from "../blocks/encodeMeshoptBlock";
import { EncodeTexturesBlock } from "../blocks/encodeTexturesBlock";
import { FlattenBlock } from "../blocks/flattenBlock";
import { InstanceBlock } from "../blocks/instanceBlock";
import { MetalRoughBlock } from "../blocks/metalRoughBlock";
import { QuantizeBlock } from "../blocks/quantizeBlock";
import { ResizeTexturesBlock } from "../blocks/resizeTexturesBlock";
import { SimplifyBlock } from "../blocks/simplifyBlock";
import { StripMaterialsBlock } from "../blocks/stripMaterialsBlock";
import { ValidateBlock } from "../blocks/validateBlock";
import { WeldBlock } from "../blocks/weldBlock";
import { GltfDocumentType } from "../connectionPoints/gltfDocument";

type TransformBlock = Block<_InputBlockDefinition & { readonly input: typeof GltfDocumentType; readonly output: typeof GltfDocumentType }>;

/** A built-in transform and its optional earlier source reference. */
export interface SerializedBlock {
    readonly type: string;
    readonly id?: string;
    readonly input?: string;
    readonly version?: 1;
    readonly config?: Readonly<Record<string, unknown>>;
}

/** Version 1 of the plain-object transform graph format. */
export interface SerializedGraph {
    readonly graph: 1;
    readonly blocks: readonly SerializedBlock[];
}

/** Connected transforms with one external Document input and one terminal output. */
export interface Graph {
    readonly blocks: readonly TransformBlock[];
    readonly head: TransformBlock;
    readonly tail: TransformBlock;
}

/** Controls whether default configuration values are included in serialized graphs. */
export interface SerializeGraphOptions {
    readonly defaults?: boolean;
}

/** An invalid serialized graph, with a field path and optional repair hint. */
export class GraphError extends Error {
    public readonly path: string;
    public readonly hint: string | undefined;

    public constructor(path: string, message: string, hint?: string) {
        super(`${path}: ${message}`);
        this.name = "GraphError";
        this.path = path;
        this.hint = hint;
    }
}

/** Parses and connects a strict version-1 graph containing only built-in transforms. */
export function parseGraph(value: unknown): Graph {
    const object = objectAt(value, "graph");
    rejectUnknownKeys(object, ["graph", "blocks"], "");
    if (object.graph !== 1) {
        throw new GraphError("graph", "Unsupported graph version.", "Use graph: 1.");
    }
    if (!Array.isArray(object.blocks) || object.blocks.length === 0) {
        throw new GraphError("blocks", "Expected a nonempty array.");
    }
    const registry = createRegistry();
    const blocks: TransformBlock[] = [];
    const ids = new Map<string, TransformBlock>();
    const sources = new Set<TransformBlock>();
    for (const [index, value] of object.blocks.entries()) {
        const path = `blocks[${index}]`;
        const entry = objectAt(value, path);
        rejectUnknownKeys(entry, ["type", "id", "input", "version", "config"], path);
        if (typeof entry.type !== "string") {
            throw new GraphError(`${path}.type`, "Expected a block type.");
        }
        const Constructor = registry.get(entry.type);
        if (Constructor === undefined) {
            throw new GraphError(
                `${path}.type`,
                "Unknown transform block type.",
                /^(input|output)\./.test(entry.type) ? "Supply input and output blocks outside the serialized graph." : `Use one of: ${[...registry.keys()].join(", ")}.`
            );
        }
        if (Object.hasOwn(entry, "version") && entry.version !== 1) {
            throw new GraphError(`${path}.version`, "Unsupported block version.", "Use version: 1 or omit it.");
        }
        if (Object.hasOwn(entry, "id")) {
            requireId(entry.id, `${path}.id`);
            if (ids.has(entry.id)) {
                throw new GraphError(`${path}.id`, "Duplicate block ID.");
            }
        }
        const config = Object.hasOwn(entry, "config") ? objectAt(entry.config, `${path}.config`) : {};
        if (Object.getOwnPropertySymbols(config).length > 0) {
            throw new GraphError(`${path}.config`, "Configuration keys must be strings.");
        }
        const definition = new Constructor()._definition;
        if (Object.keys(definition.auxiliaryInputs).length > 0) {
            throw new GraphError(path, "Auxiliary inputs are unsupported in graph version 1.");
        }
        for (const [key, value] of Object.entries(config)) {
            const descriptor = Object.hasOwn(definition.config, key) ? definition.config[key] : undefined;
            if (descriptor === undefined) {
                throw new GraphError(`${path}.config.${key}`, "Unknown configuration key.");
            }
            if (!descriptor.is(value)) {
                throw new GraphError(`${path}.config.${key}`, "Invalid configuration value.", describeValue(descriptor.descriptor));
            }
        }
        const block = new Constructor(config);
        let source = blocks[index - 1];
        if (Object.hasOwn(entry, "input")) {
            requireId(entry.input, `${path}.input`);
            source = ids.get(entry.input);
            if (source === undefined) {
                throw new GraphError(`${path}.input`, "Input must reference an earlier block ID.");
            }
        }
        if (source !== undefined) {
            source.output.connectTo(block.input);
            sources.add(source);
        }
        blocks.push(block);
        if (typeof entry.id === "string") {
            ids.set(entry.id, block);
        }
    }
    const sinks = blocks.filter((block) => !sources.has(block));
    if (sinks.length !== 1) {
        throw new GraphError("blocks", "Expected exactly one terminal block.");
    }
    return { blocks: Object.freeze(blocks), head: blocks[0]!, tail: sinks[0]! };
}

/** Serializes ordered built-in transforms, excluding their external input/output blocks. */
export function serializeGraph(blocks: readonly Block[], options: SerializeGraphOptions = {}): SerializedGraph {
    if (blocks.length === 0) {
        throw new GraphError("blocks", "Expected a nonempty array.");
    }
    const registry = createRegistry();
    const indices = new Map<_BlockRuntime, number>(blocks.map((block, index) => [block, index]));
    if (indices.size !== blocks.length) {
        throw new GraphError("blocks", "Duplicate block instance.");
    }
    const ids = new Map<number, string>();
    const inputs = new Map<number, number>();
    for (const [index, block] of blocks.entries()) {
        const path = `blocks[${index}]`;
        if (!registry.has(block._definition.type) || block.input?.type !== GltfDocumentType || block.output.type !== GltfDocumentType) {
            throw new GraphError(`${path}.type`, "Only built-in Document transforms can be serialized.", "Supply input and output blocks outside the serialized graph.");
        }
        if (Object.keys(block.auxiliaryInputs).length > 0) {
            throw new GraphError(path, "Auxiliary inputs are unsupported in graph version 1.");
        }
        const source = block.input._source?._block;
        const sourceIndex = source === undefined ? undefined : indices.get(source);
        if (sourceIndex === undefined) {
            if (index !== 0 || (source !== undefined && !source._definition.type.startsWith("input."))) {
                throw new GraphError(`${path}.input`, "Expected one external input on the first block.");
            }
        } else {
            if (sourceIndex >= index) {
                throw new GraphError(`${path}.input`, "Blocks must be in dependency order.");
            }
            inputs.set(index, sourceIndex);
            if (sourceIndex !== index - 1) {
                ids.set(sourceIndex, `block-${sourceIndex + 1}`);
            }
        }
    }
    const serialized: SerializedGraph = {
        graph: 1,
        blocks: blocks.map((block, index) => {
            const config = Object.fromEntries(
                Object.entries(block._config).filter(([key, value]) => options.defaults || !Object.is(value, block._definition.config[key]?.defaultValue))
            );
            const id = ids.get(index);
            const source = inputs.get(index);
            const input = source === undefined ? undefined : ids.get(source);
            return {
                type: block._definition.type,
                ...(id === undefined ? {} : { id }),
                ...(source === index - 1 || input === undefined ? {} : { input }),
                ...(Object.keys(config).length === 0 ? {} : { config }),
            };
        }),
    };
    parseGraph(serialized);
    return serialized;
}

function createRegistry(): ReadonlyMap<string, new (options?: Readonly<Record<string, unknown>>) => TransformBlock> {
    return new Map<string, new (options?: Readonly<Record<string, unknown>>) => TransformBlock>([
        ["transform.cull-unused", CullUnusedBlock],
        ["transform.dedup", DedupBlock],
        ["transform.dequantize", DequantizeBlock],
        ["transform.encode-draco", EncodeDracoBlock],
        ["transform.encode-ktx2", EncodeKTX2Block],
        ["transform.encode-meshopt", EncodeMeshoptBlock],
        ["transform.encode-textures", EncodeTexturesBlock],
        ["transform.flatten", FlattenBlock],
        ["transform.instance", InstanceBlock],
        ["transform.metal-rough", MetalRoughBlock],
        ["transform.quantize", QuantizeBlock],
        ["transform.resize-textures", ResizeTexturesBlock],
        ["transform.simplify", SimplifyBlock],
        ["transform.strip-materials", StripMaterialsBlock],
        ["transform.validate", ValidateBlock],
        ["transform.weld", WeldBlock],
    ]);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
        throw new GraphError(path, "Expected a plain object.");
    }
    return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || !allowed.includes(key)) {
            const name = String(key);
            throw new GraphError(path ? `${path}.${name}` : name, "Unknown key.");
        }
    }
}

function requireId(value: unknown, path: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0) {
        throw new GraphError(path, "Expected a nonempty block ID.");
    }
}

function describeValue(descriptor: ConfigDescriptor): string {
    switch (descriptor.kind) {
        case "boolean":
            return "Expected a boolean.";
        case "enum":
            return `Expected one of: ${descriptor.values.join(", ")}.`;
        case "integer":
        case "number": {
            const type = descriptor.kind === "integer" ? "an integer" : "a finite number";
            const range =
                descriptor.min !== undefined && descriptor.max !== undefined
                    ? ` from ${descriptor.min} to ${descriptor.max}`
                    : descriptor.min !== undefined
                      ? ` at least ${descriptor.min}`
                      : descriptor.max !== undefined
                        ? ` at most ${descriptor.max}`
                        : "";
            return `Expected ${type}${range}.`;
        }
        case "custom":
            return "Expected a value accepted by the block's configuration validator.";
    }
}
