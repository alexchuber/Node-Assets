import { parse } from "../arguments";
import { readGraphAsync } from "../graphFiles";
import { commandHelp } from "../help";
import { CliError, out } from "../output";

export async function showCommandAsync(argv: readonly string[]): Promise<number> {
    const { values, positionals } = parse("show", argv);
    if (values.help) out(commandHelp("show"));
    else {
        if (positionals.length !== 1) throw new CliError("USAGE", "show requires one graph", [commandHelp("show").usage]);
        out(await readGraphAsync(positionals[0]!));
    }
    return 0;
}
