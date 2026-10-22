// TOON vs JSON size of the CLI's actual stdout in the trials: every TOON stdout is decoded and re-encoded as the
// CLI's JSON mode would print it (JSON.stringify(obj, null, 2)). Tokens counted with two offline tokenizers (proxies).
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const { countTokens } = require("@anthropic-ai/tokenizer");
const { encode: gpt } = require("gpt-tokenizer");
const { decode } = await import(process.argv[2]);
const root = process.argv[3];
const by = {};
for (const d of readdirSync(root).filter((x) => x.startsWith("g2__") && !x.includes("tune-json"))) {
    const f = `${root}/${d}/calls.jsonl`;
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
        const c = JSON.parse(l);
        if (c.ev !== "end" || !c.stdout || c.outLen > 20000) continue;
        let obj;
        try { obj = decode(c.stdout); } catch { continue; }
        const cmd = c.args[0]?.startsWith("-") ? "help/home" : c.args.includes("--help") ? "help/home" : (c.args[0] ?? "help/home") + (c.args.includes("--against") ? " --against" : "");
        const j = JSON.stringify(obj, null, 2) + "\n";
        const b = (by[cmd] ??= { n: 0, toonChars: 0, jsonChars: 0, toonA: 0, jsonA: 0, toonG: 0, jsonG: 0 });
        b.n++; b.toonChars += c.stdout.length; b.jsonChars += j.length;
        b.toonA += countTokens(c.stdout); b.jsonA += countTokens(j); b.toonG += gpt(c.stdout).length; b.jsonG += gpt(j).length;
    }
}
const tot = { n: 0, toonChars: 0, jsonChars: 0, toonA: 0, jsonA: 0, toonG: 0, jsonG: 0 };
for (const [k, b] of Object.entries(by)) {
    for (const x in tot) tot[x] += b[x];
    console.log(k.padEnd(20), "n", String(b.n).padStart(4), " json/toon chars", (b.jsonChars / b.toonChars).toFixed(2), " tokens(claude-legacy)", (b.jsonA / b.toonA).toFixed(2), " tokens(o200k)", (b.jsonG / b.toonG).toFixed(2), " mean toon tokens", Math.round(b.toonA / b.n));
}
console.log("ALL".padEnd(20), "n", tot.n, " json/toon chars", (tot.jsonChars / tot.toonChars).toFixed(2), " tokens(claude-legacy)", (tot.jsonA / tot.toonA).toFixed(2), " tokens(o200k)", (tot.jsonG / tot.toonG).toFixed(2));
