// Packs only committed sources: refuses uncommitted build inputs, rebuilds, and records the commit in the tarball.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(cliRoot, "../..");
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trimEnd();

const changes = git("status", "--porcelain", "--", "packages", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml");
if (changes !== "" && process.env.NODE_ASSETS_ALLOW_DIRTY_PACK !== "1") {
    process.stderr.write(
        `prepack: uncommitted changes in build inputs:\n${changes}\n` +
            "Commit them so the tarball matches a commit, or set NODE_ASSETS_ALLOW_DIRTY_PACK=1 for a throwaway local pack.\n"
    );
    process.exit(1);
}

execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });

const { version } = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
const buildInfo = { version, commit: git("rev-parse", "HEAD"), uncommittedChanges: changes !== "" };
writeFileSync(join(cliRoot, "dist", "build-info.json"), `${JSON.stringify(buildInfo, null, 4)}\n`);
