import { parseArgs, type ParseArgsConfig } from "node:util";

import { CliError } from "./output";

export type Command = "help" | "inspect" | "tune" | "run" | "show";

export function flags(command: Command): NonNullable<ParseArgsConfig["options"]> {
    switch (command) {
        case "inspect":
            return { against: { type: "string" }, view: { type: "string" }, network: { type: "string" } };
        case "run":
            return { out: { type: "string", short: "o" }, force: { type: "boolean", short: "f" }, check: { type: "boolean" } };
        case "tune":
            return {
                for: { type: "string" },
                out: { type: "string", short: "o" },
                fidelity: { type: "string" },
                view: { type: "string" },
                network: { type: "string" },
                amortize: { type: "string" },
                keep: { type: "string" },
                "time-limit": { type: "string" },
            };
        default:
            return {};
    }
}

export function parse(command: Command, argv: readonly string[]): { values: Record<string, string | boolean | undefined>; positionals: string[] } {
    const options: NonNullable<ParseArgsConfig["options"]> = { ...flags(command), help: { type: "boolean", short: "h" } };
    try {
        return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true }) as {
            values: Record<string, string | boolean | undefined>;
            positionals: string[];
        };
    } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
        throw new CliError("USAGE", message, [
            `valid flags for ${command}: ${Object.keys(options)
                .map((flag) => `--${flag}`)
                .join(", ")}`,
        ]);
    }
}

export function stringFlag(value: string | boolean | undefined): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function viewSize(value: string | undefined): number {
    const size = value === undefined ? 1024 : Number(value);
    if (!Number.isInteger(size) || size < 16) throw new CliError("USAGE", "--view must be an integer of at least 16", ["e.g. --view 1024"]);
    return size;
}
