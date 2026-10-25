import { relative } from "node:path";
import { format } from "node:util";

import { GraphError } from "@babylonjs/node-assets";
import { encode } from "@toon-format/toon";

export { decode } from "@toon-format/toon";

export type ErrorCode = "USAGE" | "INPUT_NOT_FOUND" | "UNSUPPORTED_FORMAT" | "INVALID_INPUT" | "OUTPUT_EXISTS" | "BAD_GRAPH" | "NO_BROWSER" | "INTERNAL";

export class CliError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly help: readonly string[] = [],
        readonly exit: number = code === "USAGE" ? 2 : 1
    ) {
        super(message);
    }
}

export function asError(error: unknown): CliError {
    if (error instanceof CliError) return error;
    if (error instanceof GraphError) return new CliError("BAD_GRAPH", error.message, error.hint ? [error.hint] : []);
    if (error instanceof Error && "code" in error) {
        const help = "help" in error && Array.isArray(error.help) ? error.help.filter((item): item is string => typeof item === "string") : [];
        if (error.code === "NO_BROWSER" || error.code === "INVALID_INPUT") return new CliError(error.code, error.message.split("\n")[0]!, help);
    }
    return new CliError("INTERNAL", error instanceof Error ? error.message.split("\n")[0]! : String(error));
}

export function serialize(value: unknown): string {
    return encode(value) + "\n";
}

export function out(value: unknown): void {
    process.stdout.write(serialize(value));
}

export function progress(message: string): void {
    process.stderr.write(message + "\n");
}

export function rel(path: string): string {
    const local = relative(process.cwd(), path);
    return local && local !== ".." && !local.startsWith("../") ? local : path;
}

export function mib(bytes: number): number {
    return Math.round((bytes / 1048576) * 10) / 10;
}

export function seconds(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function withDiagnostics<T>(action: () => Promise<T>): Promise<T> {
    const saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
    const diagnostic = (...args: unknown[]) => progress(format(...args));
    Object.assign(console, { log: diagnostic, info: diagnostic, warn: diagnostic, debug: diagnostic });
    try {
        return await action();
    } finally {
        Object.assign(console, saved);
    }
}
