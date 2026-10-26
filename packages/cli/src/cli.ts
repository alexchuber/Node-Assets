import { version } from "../package.json";
import { helpCommandAsync } from "./commands/help";
import { homeCommandAsync } from "./commands/home";
import { inspectCommandAsync } from "./commands/inspect";
import { runCommandAsync } from "./commands/run";
import { showCommandAsync } from "./commands/show";
import { tuneCommandAsync } from "./commands/tune";
import { asError, CliError, out } from "./output";

export async function main(argv: readonly string[]): Promise<number> {
    try {
        const [command, ...rest] = argv;
        if (!command) return await homeCommandAsync();
        if (["--version", "-v", "-V"].includes(command) && !rest.length) {
            process.stdout.write(version + "\n");
            return 0;
        }
        if (["help", "--help", "-h"].includes(command)) return await helpCommandAsync(argv);
        if (command === "inspect") return await inspectCommandAsync(rest);
        if (command === "run") return await runCommandAsync(rest);
        if (command === "tune") return await tuneCommandAsync(rest);
        if (command === "show") return await showCommandAsync(rest);
        throw new CliError("USAGE", `Unknown command ${command}`, ["commands: inspect, tune, run, show, help"]);
    } catch (error) {
        const result = asError(error);
        out({ error: result.message, code: result.code, help: result.help });
        return result.exit;
    }
}
