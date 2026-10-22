// node coldload.cjs <glb>...  -> {path: median cold load ms over 3 fresh browser contexts}
// Uses the spike's render page (three.js r180 with Draco/Meshopt/KTX2 decoders), independent of the CLI.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "render");
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const p = u.startsWith("/m/") ? u.slice(2) : u.startsWith("/node_modules/") ? path.join(root, "..", u) : path.join(root, u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); res.end(d); });
});
(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.NA_CHROMIUM || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const out = {};
  for (const m of process.argv.slice(2)) {
    const t = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${port}/render.html`);
      await page.waitForFunction(() => window.ready);
      const r = await page.evaluate((u) => window.renderModel(u, { size: 128, views: 1 }), `/m${path.resolve(m)}`);
      t.push(r.loadMs);
      await ctx.close();
    }
    out[m] = t.sort((a, b) => a - b)[1];
  }
  console.log(JSON.stringify(out));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
