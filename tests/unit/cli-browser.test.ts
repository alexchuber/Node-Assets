import { access, stat } from "node:fs/promises";
import type { Stats } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { browserCandidates, findBrowser } from "../../packages/cli/src/render/browser";

vi.mock("node:fs/promises", () => ({ access: vi.fn(), stat: vi.fn() }));
vi.mock("../../packages/cli/node_modules/playwright-core/index.mjs", () => ({ chromium: { executablePath: () => "/cached/chromium" } }));

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
});

describe("browser discovery candidates", () => {
    it("searches Linux PATH and system installs in override, Chrome, Edge, Chromium order", () => {
        const candidates = browserCandidates({
            platform: "linux",
            env: { NODE_ASSETS_CHROMIUM: "/custom/browser", PATH: "/browser-bin:/usr/bin" },
            home: "/home/test",
        });
        expect(candidates[0]).toEqual({ executablePath: "/custom/browser", name: "Chromium" });
        const rest = candidates.slice(1);
        expect(rest.map(({ name }) => name).filter((name, index, names) => index === 0 || name !== names[index - 1])).toEqual(["Chrome", "Edge", "Chromium"]);
        expect(rest.filter(({ name }) => name === "Chrome").map(({ executablePath }) => executablePath)).toEqual([
            "/browser-bin/google-chrome",
            "/usr/bin/google-chrome",
            "/browser-bin/google-chrome-stable",
            "/usr/bin/google-chrome-stable",
            "/opt/google/chrome/chrome",
        ]);
        expect(rest.filter(({ name }) => name === "Edge").map(({ executablePath }) => executablePath)).toContain("/browser-bin/microsoft-edge");
        expect(rest.filter(({ name }) => name === "Chromium").map(({ executablePath }) => executablePath)).toEqual([
            "/browser-bin/chromium",
            "/usr/bin/chromium",
            "/browser-bin/chromium-browser",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ]);
        expect(new Set(candidates.map(({ executablePath }) => executablePath)).size).toBe(candidates.length);
    });

    it("keeps macOS system and per-user Chrome/Edge installs", () => {
        expect(browserCandidates({ platform: "darwin", env: {}, home: "/Users/test" })).toEqual([
            { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", name: "Chrome" },
            { executablePath: "/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", name: "Chrome" },
            { executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", name: "Edge" },
            { executablePath: "/Users/test/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", name: "Edge" },
        ]);
    });

    it.each([
        { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LocalAppData: "C:\\Users\\test\\AppData\\Local" },
        { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
    ])("keeps every Windows Chrome/Edge location for either environment-key casing", (env) => {
        expect(browserCandidates({ platform: "win32", env, home: "C:\\Users\\test" })).toEqual([
            { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", name: "Chrome" },
            { executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", name: "Chrome" },
            { executablePath: "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe", name: "Chrome" },
            { executablePath: "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", name: "Edge" },
            { executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", name: "Edge" },
            { executablePath: "C:\\Users\\test\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe", name: "Edge" },
        ]);
    });

    it("keeps Linux system Chromium locations when PATH is absent", () => {
        const candidates = browserCandidates({ platform: "linux", env: {}, home: "/home/test" });
        expect(candidates.filter(({ name }) => name === "Chromium").map(({ executablePath }) => executablePath)).toEqual([
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ]);
    });

    it("skips directory candidates despite executable permissions", async () => {
        vi.stubEnv("NODE_ASSETS_CHROMIUM", "");
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(stat).mockImplementation(async (path) => ({ isFile: () => path === "/cached/chromium" }) as Stats);

        await expect(findBrowser()).resolves.toEqual({ executablePath: "/cached/chromium", name: "Chromium" });
    });

    it("rejects a directory override with NO_BROWSER rather than falling back", async () => {
        vi.stubEnv("NODE_ASSETS_CHROMIUM", "/override/directory");
        vi.mocked(access).mockResolvedValue(undefined);
        vi.mocked(stat).mockImplementation(async (path) => ({ isFile: () => path === "/cached/chromium" }) as Stats);

        await expect(findBrowser()).rejects.toMatchObject({ code: "NO_BROWSER", help: expect.any(Array) });
    });

    it("requires execute permissions on an override file", async () => {
        vi.stubEnv("NODE_ASSETS_CHROMIUM", "/override/browser");
        vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Stats);
        vi.mocked(access).mockRejectedValue(new Error("Permission denied"));

        await expect(findBrowser()).rejects.toMatchObject({ code: "NO_BROWSER" });
    });

    it("accepts an executable override file", async () => {
        vi.stubEnv("NODE_ASSETS_CHROMIUM", "/override/browser");
        vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Stats);
        vi.mocked(access).mockResolvedValue(undefined);

        await expect(findBrowser()).resolves.toEqual({ executablePath: "/override/browser", name: "Chromium" });
    });
});
