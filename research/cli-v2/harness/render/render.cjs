// node render.cjs <out_dir> <size> <views> <reference.glb> <candidate.glb>...
// Renders the reference first, then every candidate with the reference's camera framing.
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const [outDir, sizeArg, viewsArg, ...models] = process.argv.slice(2);
const size = Number(sizeArg), views = Number(viewsArg);
const root = __dirname;
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary" };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const p = u.startsWith("/m/") ? u.slice(2) : u.startsWith("/node_modules/") ? path.join(root, "..", u) : path.join(root, u);
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.NA_CHROMIUM || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`http://localhost:${port}/render.html`);
  await page.waitForFunction(() => window.ready);
  fs.mkdirSync(outDir, { recursive: true });
  let frame = null;
  const timings = [];
  for (const m of models) {
    const url = `/m${path.resolve(m)}`;
    const t0 = Date.now();
    const r = await page.evaluate(([url, o]) => window.renderModel(url, o), [url, { size, views, frame }]);
    frame = frame ?? r.frame;
    const name = path.basename(m, ".glb");
    r.images.forEach((d, i) => fs.writeFileSync(path.join(outDir, `${name}__v${i}.png`), Buffer.from(d.split(",")[1], "base64")));
    timings.push({ model: name, wallMs: Date.now() - t0, loadMs: Math.round(r.loadMs), renderMs: Math.round(r.renderMs) });
  }
  console.log(JSON.stringify({ size, views, timings }));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
