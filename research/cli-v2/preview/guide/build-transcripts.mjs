import { readFileSync, writeFileSync } from "node:fs";

const files = new URL("../", import.meta.url);
const blocks = (path) => {
    const out = [];
    for (const line of readFileSync(new URL(path, files), "utf8").split("\n")) {
        if (line.startsWith("$ ")) out.push({ cmd: line.slice(2), lines: [line] });
        else if (out.length) out.at(-1).lines.push(line);
    }
    return out.map((b) => ({ ...b, text: b.lines.join("\n").replace(/\n+$/, "") }));
};
const smoke = blocks("transcript-ab42afe/smoke.txt");
const flow = blocks("transcript/workflow.txt");
const pick = (list, cmd) => {
    const found = list.filter((b) => b.cmd === cmd);
    if (!found.length) throw new Error(`missing: ${cmd}`);
    return found.map((b) => b.text).join("\n\n");
};

const SMOKE = { commit: "ab42afe", note: "baseline install evidence · stdout + stderr · paths redacted" };
const FLOW = { commit: "a9329e2", note: "older build, before the structure cleanup · stdout only · paths redacted" };
const examples = [
    { id: "home", label: "Home screen", src: FLOW, render: false, text: pick(flow, "node-assets") },
    { id: "inspect", label: "inspect a file", src: SMOKE, render: false, text: pick(smoke, "node-assets inspect duck.glb") },
    { id: "inspect-dir", label: "inspect a folder", src: FLOW, render: false, text: pick(flow, "node-assets inspect assets/") },
    { id: "tune", label: "tune for size + gpu", src: FLOW, render: true, text: pick(flow, "node-assets tune assets/duck.glb --for size,gpu -o graphs/") },
    { id: "check", label: "run --check", src: FLOW, render: true, text: pick(flow, "node-assets run graphs/duck.size.toon assets/duck.glb -o public/duck.glb --check") },
    { id: "run", label: "run optimize, twice", src: SMOKE, render: false, text: pick(smoke, "node-assets run optimize duck.glb -o out/duck.glb") },
    { id: "against", label: "inspect --against", src: FLOW, render: true, text: pick(flow, "node-assets inspect public/ --against assets/") },
    { id: "show", label: "show optimize", src: SMOKE, render: false, text: pick(smoke, "node-assets show optimize") },
    { id: "cmd-help", label: "show --help", src: SMOKE, render: false, text: pick(smoke, "node-assets show --help") },
    { id: "usage", label: "usage error", src: SMOKE, render: false, text: pick(smoke, "node-assets tune") },
];

const attr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
let html = "\n<!-- Real CLI output, generated from saved transcripts. Do not edit by hand. -->\n";
for (const e of examples) {
    if (/<\/script/i.test(e.text)) throw new Error(`unsafe text in ${e.id}`);
    html += `<script type="text/plain" class="example" id="ex-${e.id}" data-label="${attr(e.label)}" data-commit="${e.src.commit}" data-note="${attr(e.src.note)}" data-render="${e.render}">\n${e.text}\n</script>\n`;
}
writeFileSync(new URL("parts/6-transcripts.html", import.meta.url), html);
console.log(examples.map((e) => `${e.id}: ${e.text.split("\n").length} lines`).join("\n"));
