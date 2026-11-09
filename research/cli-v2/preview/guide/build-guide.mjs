import { readFileSync, writeFileSync } from "node:fs";

const parts = [
    "1-head.html",
    "2-top.html",
    "3-try-goals.html",
    "4-tune-fidelity-graphs.html",
    "5-output-rest.html",
    "6-transcripts.html",
    "7-script-core.html",
    "8-script-sections.html",
];
const html = parts.map((part) => readFileSync(new URL(`parts/${part}`, import.meta.url), "utf8")).join("");
writeFileSync(new URL("node-assets-cli-guide.html", import.meta.url), html);
