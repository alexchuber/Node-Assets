import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { NodeIO } from "@gltf-transform/core";
import type { Browser, BrowserContext, Page } from "playwright-core";

import { findBrowserAsync } from "./browser";
import { emptyModelError } from "./errors";
import type { EvaluationResult, ReferenceOptions, ReferenceResult } from "./protocol";

export { findBrowserAsync } from "./browser";
export type { EvaluationResult, Frame, ReferenceOptions, ReferenceResult } from "./protocol";

export interface RendererOptions {
    readonly onRequest?: (url: string) => void;
}

/** An isolated offline renderer. Operations on an instance must be awaited sequentially. */
export interface FidelityRenderer {
    readonly browserName: string | undefined;
    startAsync(): Promise<void>;
    stopAsync(): Promise<void>;
    /** Frames an embedded GLB at 1024px/four views by default; rejects an empty view with INVALID_INPUT. */
    setReferenceAsync(bytes: Uint8Array, options?: ReferenceOptions): Promise<ReferenceResult>;
    /** Reuses reference framing and returns three-decimal worst-tile SSIM, its view index, and warm loadMs. */
    evaluateAsync(bytes: Uint8Array): Promise<EvaluationResult>;
    /** Returns a PNG with the reference on the left and last candidate on the right. */
    previewAsync(view: number): Promise<Buffer>;
}

/** Creates a lazy offline SwiftShader renderer for embedded GLBs. Await calls sequentially and stop in finally. */
export function createRenderer(options: RendererOptions = {}): FidelityRenderer {
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let browserName: string | undefined;
    let startPromise: Promise<void> | undefined;
    let ioPromise: Promise<NodeIO> | undefined;
    let profile: string | undefined;
    let origin: string | undefined;
    let blobId = 0;
    let views = 0;
    let hasCandidate = false;
    const blobs = new Map<string, Uint8Array>();
    const server = createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
            const bytes = blobs.get(pathname);
            if (bytes) {
                response.writeHead(200, { "content-type": "model/gltf-binary" });
                response.end(bytes);
                return;
            }
            const root = await renderDirectoryAsync();
            const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
            if (!path.startsWith(root + sep)) {
                response.writeHead(404).end();
                return;
            }
            const body = await readFile(path);
            const type = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" }[extname(path)] ?? "application/octet-stream";
            response.writeHead(200, {
                "content-type": type,
                "content-security-policy":
                    "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'",
            });
            response.end(body);
        } catch {
            response.writeHead(404).end();
        }
    });

    async function startAsync(): Promise<void> {
        if (startPromise) return startPromise;
        startPromise = (async () => {
            try {
                const location = await findBrowserAsync();
                await renderDirectoryAsync();
                await new Promise<void>((resolve, reject) => {
                    server.once("error", reject);
                    server.listen(0, "127.0.0.1", () => {
                        server.removeListener("error", reject);
                        resolve();
                    });
                });
                const address = server.address();
                if (!address || typeof address === "string") throw new Error("Renderer server did not bind.");
                origin = `http://127.0.0.1:${address.port}`;
                const { chromium } = await import("playwright-core");
                // Keep Playwright's browser profile and scratch files inside the project, not the OS temp directory.
                profile = resolve(`_render-${randomUUID()}`);
                await mkdir(profile);
                context = await chromium.launchPersistentContext(profile, {
                    executablePath: location.executablePath,
                    headless: true,
                    deviceScaleFactor: 1,
                    viewport: { width: 256, height: 256 },
                    serviceWorkers: "block",
                    artifactsDir: profile,
                    downloadsPath: profile,
                    env: { ...process.env, TMPDIR: profile, TMP: profile, TEMP: profile },
                    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
                });
                browser = context.browser() ?? undefined;
                browserName = `${location.name} ${browser?.version() ?? "unknown"} (SwiftShader)`;
                context.on("request", (request) => options.onRequest?.(request.url()));
                await context.route("**/*", async (route) => {
                    if (new URL(route.request().url()).origin === origin) await route.continue();
                    else await route.abort("blockedbyclient");
                });
            } catch (error) {
                await stopAsync();
                throw error;
            }
        })();
        return startPromise;
    }

    async function stopAsync(): Promise<void> {
        await context?.close().catch(() => {});
        await browser?.close().catch(() => {});
        context = undefined;
        browser = undefined;
        page = undefined;
        browserName = undefined;
        views = 0;
        hasCandidate = false;
        blobs.clear();
        ioPromise = undefined;
        startPromise = undefined;
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        if (profile) await rm(profile, { recursive: true, force: true });
        profile = undefined;
    }

    async function putAsync(bytes: Uint8Array): Promise<string> {
        ioPromise ??= createIOAsync();
        const io = await ioPromise;
        const document = await io.readBinary(bytes);
        document.disposeExtension("KHR_draco_mesh_compression");
        document.disposeExtension("EXT_meshopt_compression");
        const path = `/blob/model-${++blobId}.glb`;
        blobs.set(path, await io.writeBinary(document));
        return path;
    }

    return {
        get browserName() {
            return browserName;
        },
        startAsync,
        stopAsync,
        async setReferenceAsync(bytes, { size = 1024, views: count = 4 } = {}) {
            if (!Number.isInteger(size) || size < 16 || !Number.isInteger(count) || count < 1) throw new Error("Invalid reference dimensions.");
            await startAsync();
            await page?.close();
            page = undefined;
            hasCandidate = false;
            views = 0;
            const path = await putAsync(bytes);
            try {
                const nextPage = await context!.newPage();
                page = nextPage;
                nextPage.setDefaultTimeout(60_000);
                await nextPage.setViewportSize({ width: size, height: size });
                await nextPage.goto(origin!);
                await nextPage.waitForFunction(() => !!window.fidelityRenderer);
                const result = await callPageAsync(nextPage, path, { size, views: count });
                views = count;
                return result;
            } finally {
                blobs.delete(path);
            }
        },
        async evaluateAsync(bytes) {
            if (!page || !views) throw new Error("Set a reference before evaluating.");
            const path = await putAsync(bytes);
            hasCandidate = false;
            try {
                const result = await callPageAsync(page, path);
                hasCandidate = true;
                return { ...result, worst: Math.round(result.worst * 1000) / 1000 };
            } finally {
                blobs.delete(path);
            }
        },
        async previewAsync(view) {
            if (!page || !hasCandidate || !Number.isInteger(view) || view < 0 || view >= views) throw new Error("Evaluate a candidate and select a valid view before previewing.");
            const data = await page.evaluate((index) => window.fidelityRenderer!.preview(index), view);
            return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
        },
    };
}

async function callPageAsync(page: Page, url: string, options: Required<ReferenceOptions>): Promise<ReferenceResult>;
async function callPageAsync(page: Page, url: string): Promise<EvaluationResult>;
async function callPageAsync(page: Page, url: string, options?: Required<ReferenceOptions>): Promise<ReferenceResult | EvaluationResult> {
    const result = await page.evaluate(
        async ({ url, options }) => {
            try {
                const value = options ? await window.fidelityRenderer!.setReference(url, options) : await window.fidelityRenderer!.evaluate(url);
                return { ok: true as const, value };
            } catch (error) {
                // Playwright drops custom Error properties; send the input-error discriminator explicitly.
                if (error instanceof Error && "code" in error && error.code === "INVALID_INPUT") return { ok: false as const };
                throw error;
            }
        },
        { url, options }
    );
    if (!result.ok) throw emptyModelError();
    return result.value;
}

async function renderDirectoryAsync(): Promise<string> {
    const directory = dirname(fileURLToPath(import.meta.url));
    for (const root of [resolve(directory, "render"), resolve(directory, "../../dist/render")]) {
        if (
            await access(join(root, "index.html")).then(
                () => true,
                () => false
            )
        )
            return resolve(root);
    }
    throw Object.assign(new Error("Renderer page is not built."), { code: "RENDERER_NOT_BUILT", help: ["pnpm --filter node-assets-cli build"] });
}

async function createIOAsync(): Promise<NodeIO> {
    const [{ NodeIO }, { ALL_EXTENSIONS }, { createDecoderModule }, { MeshoptDecoder }] = await Promise.all([
        import("@gltf-transform/core"),
        import("@gltf-transform/extensions"),
        import("draco3dgltf"),
        import("meshoptimizer"),
    ]);
    const wasmBinary = await readFile(createRequire(import.meta.url).resolve("draco3dgltf/draco_decoder_gltf.wasm"));
    const [decoder] = await Promise.all([createDecoderModule({ wasmBinary }), MeshoptDecoder.ready]);
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": decoder, "meshopt.decoder": MeshoptDecoder });
}
