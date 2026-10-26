import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { chromium, type Browser, type BrowserContext } from "playwright-core";

import { writeAtomicAsync } from "../../src/files";
import { findBrowserAsync } from "../../src/render/browser";

export async function prepareDecodersAsync(cache: string) {
    const names = ["draco_wasm_wrapper_gltf.js", "draco_decoder_gltf.wasm", "draco_decoder_gltf.js", "meshopt_decoder.js"];
    const files = [];
    for (const name of names) {
        const path = join(cache, name);
        const url = `https://cdn.babylonjs.com/${name}`;
        let bytes = await readFile(path).catch(() => undefined);
        if (!bytes) {
            process.stderr.write(`Caching ${url}\n`);
            const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
            if (!response.ok) throw new Error(`Decoder download failed (${response.status}): ${url}`);
            bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length || bytes.subarray(0, 100).toString().trimStart().startsWith("<")) throw new Error(`Invalid decoder download: ${url}`);
            await writeAtomicAsync(path, bytes);
        }
        files.push({ name, url, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    return files;
}

export async function startColdLoaderAsync(cliRoot: string) {
    const pageRoot = resolve(cliRoot, ".dev/page");
    const decoderRoot = join(cliRoot, ".cache/babylon-decoders");
    const ktxRoot = join(cliRoot, "dist/render/codecs");
    for (const path of [join(pageRoot, "index.html"), join(ktxRoot, "ktx2Decoder.js")]) {
        await access(path).catch(() => {
            throw new Error("Build the CLI and calibration page first: pnpm --filter node-assets-cli build && pnpm --filter node-assets-cli calibrate:build");
        });
    }
    const location = await findBrowserAsync();
    const decoders = await prepareDecodersAsync(decoderRoot);
    let bytes: Uint8Array | undefined;
    let browser: Browser | undefined;
    let host: BrowserContext | undefined;
    const profile = join(cliRoot, ".cache", `calibrate-${randomUUID()}`);
    const server = createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
            response.setHeader("cache-control", "no-store");
            if (pathname === "/model.glb" && bytes) {
                response.writeHead(200, { "content-type": "model/gltf-binary" }).end(bytes);
                return;
            }
            let path: string;
            if (pathname.startsWith("/codecs/")) {
                const name = pathname.slice("/codecs/".length);
                if (name !== name.split(/[/\\]/).at(-1) || name === "." || name === "..") throw new Error("Invalid codec path.");
                path = join(decoders.some((file) => file.name === name) ? decoderRoot : ktxRoot, name);
            } else {
                path = resolve(pageRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
                if (!path.startsWith(pageRoot + sep)) throw new Error("Invalid page path.");
            }
            const body = await readFile(path);
            response.writeHead(200, {
                "content-type": { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" }[extname(path)] ?? "application/octet-stream",
                "content-security-policy":
                    "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'",
            });
            response.end(body);
        } catch {
            response.writeHead(404).end();
        }
    });
    async function stopAsync() {
        await host?.close().catch(() => {});
        await browser?.close().catch(() => {});
        if (server.listening) await new Promise<void>((done) => server.close(() => done()));
        await rm(profile, { recursive: true, force: true });
    }
    try {
        await new Promise<void>((done, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.removeListener("error", reject);
                done();
            });
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Calibration server did not bind.");
        const origin = `http://127.0.0.1:${address.port}`;
        await mkdir(profile, { recursive: true });
        host = await chromium.launchPersistentContext(profile, {
            executablePath: location.executablePath,
            headless: true,
            viewport: { width: 64, height: 64 },
            serviceWorkers: "block",
            artifactsDir: profile,
            downloadsPath: profile,
            env: { ...process.env, TMPDIR: profile, TMP: profile, TEMP: profile },
            args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        });
        browser = host.browser() ?? undefined;
        if (!browser) throw new Error("Browser did not start.");
        const browserName = `${location.name} ${browser.version()} (SwiftShader)`;
        return {
            browserName,
            decoders,
            stopAsync,
            async measureAsync(model: Uint8Array) {
                // Never rewrite/decompress the GLB: the browser must exercise the real codecs.
                bytes = model;
                let context: BrowserContext | undefined;
                const blocked: string[] = [];
                const requested = new Set<string>();
                try {
                    context = await browser!.newContext({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1, serviceWorkers: "block" });
                    await context.route("**/*", async (route) => {
                        const url = new URL(route.request().url());
                        if (url.origin !== origin) {
                            blocked.push(url.href);
                            await route.abort("blockedbyclient");
                        } else {
                            if (url.pathname.startsWith("/codecs/")) requested.add(url.pathname.slice("/codecs/".length));
                            await route.continue();
                        }
                    });
                    const page = await context.newPage();
                    page.setDefaultTimeout(120_000);
                    await page.goto(origin, { waitUntil: "load" });
                    await page.waitForFunction(() => !!window.coldLoad);
                    const result = await page.evaluate(async (url) => {
                        if (!window.coldLoad) throw new Error("Cold-load page is not initialized.");
                        return Promise.race([
                            window.coldLoad(url),
                            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Cold load exceeded 120 seconds.")), 120_000)),
                        ]);
                    }, `${origin}/model.glb`);
                    if (blocked.length) throw new Error(`Nonlocal measurement request blocked: ${blocked.join(", ")}`);
                    return { ...result, decoders: [...requested].sort() };
                } finally {
                    bytes = undefined;
                    await context?.close();
                }
            },
        };
    } catch (error) {
        await stopAsync();
        throw error;
    }
}
