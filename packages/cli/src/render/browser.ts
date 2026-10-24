import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BrowserLocation {
    readonly executablePath: string;
    readonly name: string;
}

/** Finds a browser without launching it. Throws an actionable NO_BROWSER error if none is installed. */
export async function findBrowser(): Promise<BrowserLocation> {
    const candidates: BrowserLocation[] = [];
    if (process.env.NODE_ASSETS_CHROMIUM) candidates.push({ executablePath: process.env.NODE_ASSETS_CHROMIUM, name: "Chromium" });
    if (process.platform === "darwin") {
        for (const root of ["/Applications", join(homedir(), "Applications")]) {
            candidates.push({ executablePath: join(root, "Google Chrome.app/Contents/MacOS/Google Chrome"), name: "Chrome" });
        }
        for (const root of ["/Applications", join(homedir(), "Applications")]) {
            candidates.push({ executablePath: join(root, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"), name: "Edge" });
        }
    } else if (process.platform === "win32") {
        const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter((root): root is string => !!root);
        for (const root of roots) candidates.push({ executablePath: join(root, "Google/Chrome/Application/chrome.exe"), name: "Chrome" });
        for (const root of roots) candidates.push({ executablePath: join(root, "Microsoft/Edge/Application/msedge.exe"), name: "Edge" });
    } else {
        for (const executablePath of ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
            candidates.push({ executablePath, name: "Chrome" });
        }
        for (const executablePath of ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]) {
            candidates.push({ executablePath, name: "Edge" });
        }
    }
    for (const candidate of candidates) {
        if (await executableExists(candidate.executablePath)) return candidate;
    }
    const { chromium } = await import("playwright-core");
    const executablePath = chromium.executablePath();
    if (await executableExists(executablePath)) return { executablePath, name: "Chromium" };
    throw Object.assign(new Error("No Chromium browser found."), {
        error: "No Chromium browser found.",
        code: "NO_BROWSER",
        help: ["npx playwright install chromium"],
    });
}

async function executableExists(path: string): Promise<boolean> {
    return access(path, constants.X_OK).then(
        () => true,
        () => false
    );
}
