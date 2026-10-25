#!/usr/bin/env node

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--version", "-v", "-V"].includes(args[0])) {
        console.log(require("../package.json").version);
    } else {
        import("../dist/cli.js")
            .then(async ({ main }) => {
                process.exitCode = await main(args);
            })
            .catch(() => {
                console.log("error: CLI could not start\ncode: INTERNAL\nhelp[1]: Reinstall node-assets-cli");
                process.exitCode = 1;
            });
    }
}
