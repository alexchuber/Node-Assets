import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface BrowserLocation {
    readonly executablePath: string;
    readonly name: string;
}

/** Lists installed-browser candidates in discovery order, without filesystem probes or browser launches. */
export function browserCandidates({ platform, env, home }: { readonly platform: NodeJS.Platform; readonly env: NodeJS.ProcessEnv; readonly home: string }): BrowserLocation[] {
    const candidates: BrowserLocation[] = [];
    if (env.NODE_ASSETS_CHROMIUM) candidates.push({ executablePath: env.NODE_ASSETS_CHROMIUM, name: "Chromium" });
    if (platform === "darwin") {
        for (const root of ["/Applications", posix.join(home, "Applications")]) {
            candidates.push({ executablePath: posix.join(root, "Google Chrome.app/Contents/MacOS/Google Chrome"), name: "Chrome" });
        }
        for (const root of ["/Applications", posix.join(home, "Applications")]) {
            candidates.push({ executablePath: posix.join(root, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"), name: "Edge" });
        }
    } else if (platform === "win32") {
        const roots = [env.ProgramFiles ?? env.PROGRAMFILES, env["ProgramFiles(x86)"] ?? env["PROGRAMFILES(X86)"], env.LocalAppData ?? env.LOCALAPPDATA].filter(
            (root): root is string => !!root
        );
        for (const root of roots) candidates.push({ executablePath: win32.join(root, "Google/Chrome/Application/chrome.exe"), name: "Chrome" });
        for (const root of roots) candidates.push({ executablePath: win32.join(root, "Microsoft/Edge/Application/msedge.exe"), name: "Edge" });
    } else {
        const onPath = (commands: readonly string[]) => commands.flatMap((command) => (env.PATH ? env.PATH.split(":").map((root) => posix.join(root || ".", command)) : []));
        for (const executablePath of new Set([
            ...onPath(["google-chrome", "google-chrome-stable"]),
            "/opt/google/chrome/chrome",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
        ])) {
            candidates.push({ executablePath, name: "Chrome" });
        }
        for (const executablePath of new Set([
            ...onPath(["microsoft-edge", "microsoft-edge-stable"]),
            "/opt/microsoft/msedge/msedge",
            "/usr/bin/microsoft-edge",
            "/usr/bin/microsoft-edge-stable",
        ])) {
            candidates.push({ executablePath, name: "Edge" });
        }
        for (const executablePath of new Set([...onPath(["chromium", "chromium-browser"]), "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"])) {
            candidates.push({ executablePath, name: "Chromium" });
        }
    }
    return candidates.filter((candidate, index) => candidates.findIndex(({ executablePath }) => executablePath === candidate.executablePath) === index);
}

/** Finds a browser without launching it. Invalid overrides and missing browsers throw actionable NO_BROWSER errors. */
export async function findBrowserAsync(): Promise<BrowserLocation> {
    const override = process.env.NODE_ASSETS_CHROMIUM;
    const candidates = browserCandidates({ platform: process.platform, env: process.env, home: homedir() });
    for (const candidate of candidates) {
        if (await executableExistsAsync(candidate.executablePath)) return candidate;
        if (candidate.executablePath === override) {
            const message = `NODE_ASSETS_CHROMIUM is not an executable file: ${override}`;
            throw Object.assign(new Error(message), {
                error: message,
                code: "NO_BROWSER",
                help: ["Set NODE_ASSETS_CHROMIUM to an executable browser file, or unset it to enable browser discovery."],
            });
        }
    }
    const { chromium } = await import("playwright-core");
    const executablePath = chromium.executablePath();
    if (await executableExistsAsync(executablePath)) return { executablePath, name: "Chromium" };
    throw Object.assign(new Error("No Chromium browser found."), {
        error: "No Chromium browser found.",
        code: "NO_BROWSER",
        help: ["npx playwright install chromium"],
    });
}

async function executableExistsAsync(path: string): Promise<boolean> {
    try {
        if (!(await stat(path)).isFile()) return false;
        await access(path, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}
