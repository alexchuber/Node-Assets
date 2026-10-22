// Headless three.js renderer. One warm page holds the reference render and scores candidates in-page
// (worst 64px-region SSIM over N views). Cold load timing uses a fresh browser context.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const THREE_ROOT = process.env.NA_THREE_ROOT ?? here; // serves /node_modules/three/... from this directory
// Chromium: NA_CHROMIUM, else Playwright's own browser (npx playwright install chromium).
const CHROME = process.env.NA_CHROMIUM || undefined;
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };

let S;
async function start() {
    if (S) return S;
    const { chromium } = await import("playwright");
    const blobs = new Map();
    const server = http.createServer(async (req, res) => {
        const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
        try {
            if (u.startsWith("/blob/")) {
                const b = blobs.get(u.slice(6));
                if (!b) throw new Error("missing");
                res.writeHead(200, { "content-type": "model/gltf-binary" });
                return res.end(Buffer.from(b));
            }
            const p = u === "/render.html" ? path.join(here, "render.html") : path.join(THREE_ROOT, u);
            const d = await readFile(p);
            res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
            res.end(d);
        } catch {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    S = { server, browser, blobs, port: server.address().port, n: 0, page: null };
    return S;
}
const put = (s, bytes) => {
    const id = `m${++s.n}.glb`;
    s.blobs.set(id, bytes);
    return id;
};
async function newPage(s, size) {
    const ctx = await s.browser.newContext({ viewport: { width: size, height: size } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${s.port}/render.html`);
    await page.waitForFunction(() => window.ready);
    return { ctx, page };
}

export async function stopRenderer() {
    if (!S) return;
    await S.browser.close().catch(() => {});
    S.server.close();
    S = undefined;
}

// Render the reference in a fresh warm page that later scores candidates.
export async function setReference(bytes, { size = 1024, views = 4 } = {}) {
    const s = await start();
    if (s.page) await s.page.ctx.close();
    s.page = await newPage(s, size);
    const id = put(s, bytes);
    const r = await s.page.page.evaluate(([u, o]) => window.setReference(u, o), [`/blob/${id}`, { size, views }]);
    s.blobs.delete(id);
    return r;
}

// Score a candidate against the reference: { worst, worstView, loadMs (warm) }.
export async function evaluate(bytes) {
    const s = await start();
    const id = put(s, bytes);
    try {
        const r = await s.page.page.evaluate((u) => window.evaluate(u), `/blob/${id}`);
        return { worst: Math.round(r.worst * 1000) / 1000, worstView: r.worstView, loadMs: Math.round(r.loadMs) };
    } finally {
        s.blobs.delete(id);
    }
}

// Side-by-side PNG (reference | last evaluated candidate) at a view.
export async function preview(view) {
    const d = await S.page.page.evaluate((v) => window.preview(v), view);
    return Buffer.from(d.split(",")[1], "base64");
}

// Cold load: fresh context, decoders not yet fetched or compiled. Returns ms.
export async function coldLoad(bytes) {
    const s = await start();
    const id = put(s, bytes);
    const { ctx, page } = await newPage(s, 256);
    try {
        return Math.round(await page.evaluate((u) => window.coldLoad(u), `/blob/${id}`));
    } finally {
        s.blobs.delete(id);
        await ctx.close();
    }
}
