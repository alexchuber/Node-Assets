import { version } from "../package.json";
import { parse } from "./arguments";
import { home } from "./commands/home";
import { cmdInspect } from "./commands/inspect";
import { cmdRun } from "./commands/run";
import { cmdTune } from "./commands/tune";
import { readGraph } from "./graphFiles";
import { commandHelp, manual } from "./help";
import { asError, CliError, out } from "./output";

export async function main(argv: readonly string[]): Promise<number> {
    try {
        const [command, ...rest] = argv;
        if (!command) return await home();
        if (["--version", "-v", "-V"].includes(command) && !rest.length) {
            process.stdout.write(version + "\n");
            return 0;
        }
        if (["help", "--help", "-h"].includes(command)) {
            const { values, positionals } = parse("help", rest);
            if (positionals.length) throw new CliError("USAGE", "help takes no arguments", ["node-assets <command> --help"]);
            if (values.help && command === "help") out(commandHelp("help"));
            else process.stdout.write(manual());
            return 0;
        }
        if (command === "inspect") return await cmdInspect(rest);
        if (command === "run") return await cmdRun(rest);
        if (command === "tune") return await cmdTune(rest);
        if (command === "show") {
            const { values, positionals } = parse("show", rest);
            if (values.help) out(commandHelp("show"));
            else {
                if (positionals.length !== 1) throw new CliError("USAGE", "show requires one graph", [commandHelp("show").usage]);
                out(await readGraph(positionals[0]!));
            }
            return 0;
        }
        throw new CliError("USAGE", `Unknown command ${command}`, ["commands: inspect, tune, run, show, help"]);
    } catch (error) {
        const result = asError(error);
        out({ error: result.message, code: result.code, help: result.help });
        return result.exit;
    }
}
