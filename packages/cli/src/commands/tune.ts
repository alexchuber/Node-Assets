import { parse } from "../arguments";
import { commandHelp } from "../help";
import { CliError, out } from "../output";

export async function cmdTune(argv: readonly string[]): Promise<number> {
    const { values } = parse("tune", argv);
    if (values.help) {
        out(commandHelp("tune"));
        return 0;
    }
    throw new CliError("INTERNAL", "The tune search is not implemented in this build", ["node-assets run optimize <input> -o <out.glb>"]);
}
