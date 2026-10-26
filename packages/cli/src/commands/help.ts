import { parse } from "../arguments";
import { commandHelp, manual } from "../help";
import { CliError, out } from "../output";

export async function helpCommandAsync(argv: readonly string[]): Promise<number> {
    const [command, ...rest] = argv;
    const { values, positionals } = parse("help", rest);
    if (positionals.length) throw new CliError("USAGE", "help takes no arguments", ["node-assets <command> --help"]);
    if (values.help && command === "help") out(commandHelp("help"));
    else process.stdout.write(manual());
    return 0;
}
