#!/usr/bin/env node
/*
 * ListenAlongFix installer (Windows, macOS, Linux)
 *
 *   node install.mjs                  install both halves
 *   node install.mjs --skip-vencord   only (re)install the Spicetify extension
 *   node install.mjs --skip-spicetify only (re)build and install the Vencord plugin
 *
 * Environment:
 *   VENCORD_USER_DATA_DIR   override the Vencord data folder (the one containing dist/)
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLUGIN_NAME = "ListenAlongFix";
const EXTENSION_FILE = "listenAlongFix.js";
const OS = platform();
const IS_WIN = OS === "win32";
const SHELL_CMDS = new Set(["npx", "spicetify"]);

const args = new Set(process.argv.slice(2));
const skipVencord = args.has("--skip-vencord");
const skipSpicetify = args.has("--skip-spicetify");

const step = msg => console.log(`\n\x1b[36m==> ${msg}\x1b[0m`);
const warn = msg => console.warn(`\x1b[33mWARNING: ${msg}\x1b[0m`);
const fail = msg => {
    console.error(`\x1b[31mERROR: ${msg}\x1b[0m`);
    process.exit(1);
};

/** Run a command, inheriting output. Throws on non-zero exit unless allowFail. */
function run(cmd, cmdArgs, { cwd, allowFail = false, capture = false } = {}) {
    const res = spawnSync(cmd, cmdArgs, {
        cwd,
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
        encoding: "utf8",
        // npx is a .cmd shim on Windows and needs a shell. Only used for commands
        // whose arguments never contain paths, so no quoting is needed.
        shell: IS_WIN && SHELL_CMDS.has(cmd)
    });
    if (res.error && !allowFail) fail(`could not run '${cmd}': ${res.error.message}`);
    if (res.status !== 0 && !allowFail) fail(`'${cmd} ${cmdArgs.join(" ")}' failed (exit ${res.status})`);
    return res;
}

function has(cmd) {
    const res = spawnSync(IS_WIN ? "where" : "which", [cmd], { stdio: "ignore" });
    return res.status === 0;
}

/** Same base folder the official Vencord installer uses (os.UserConfigDir()/Vencord). */
function vencordDataDirs() {
    if (process.env.VENCORD_USER_DATA_DIR) return [process.env.VENCORD_USER_DATA_DIR];

    const home = homedir();
    switch (OS) {
        case "win32":
            return [join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Vencord")];
        case "darwin":
            return [join(home, "Library", "Application Support", "Vencord")];
        default:
            return [
                join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Vencord"),
                // Flatpak Discord keeps its config inside the sandbox
                join(home, ".var", "app", "com.discordapp.Discord", "config", "Vencord")
            ];
    }
}

function closeDiscord() {
    if (IS_WIN) run("taskkill", ["/F", "/IM", "Discord.exe"], { allowFail: true, capture: true });
    else for (const name of ["Discord", "discord", ".Discord-wrapped"])
        run("pkill", ["-x", name], { allowFail: true, capture: true });
    // Give Discord a moment to release its files
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 2000)"]);
}

function startDiscord() {
    const detach = (cmd, cmdArgs) => spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref();

    if (IS_WIN) {
        const update = join(process.env.LOCALAPPDATA ?? "", "Discord", "Update.exe");
        if (existsSync(update)) return detach(update, ["--processStart", "Discord.exe"]);
    } else if (OS === "darwin") {
        return detach("open", ["-a", "Discord"]);
    } else if (has("discord")) {
        return detach("discord", []);
    }
    console.log("Start Discord again yourself to load the plugin.");
}

function installVencord() {
    if (!has("git")) fail("git not found. Install git first.");
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < 22) fail(`Node.js 22+ required to build Vencord (you have ${process.versions.node}).`);

    const dataDir = vencordDataDirs().find(d => existsSync(join(d, "dist")));
    if (!dataDir) {
        fail(
            "Vencord doesn't seem to be installed. Looked for a dist/ folder in:\n  " +
            vencordDataDirs().join("\n  ") +
            "\nInstall Vencord first, or set VENCORD_USER_DATA_DIR."
        );
    }
    const liveDist = join(dataDir, "dist");
    console.log(`Vencord folder: ${dataDir}`);

    const src = join(ROOT, ".vencord-src");
    step("Fetching Vencord source");
    if (existsSync(join(src, ".git"))) run("git", ["-C", src, "pull", "--ff-only"]);
    else run("git", ["clone", "--depth", "1", "https://github.com/Vendicated/Vencord", src]);

    step("Copying plugin into userplugins");
    const dest = join(src, "src", "userplugins", "listenAlongFix");
    mkdirSync(dest, { recursive: true });
    cpSync(join(ROOT, "vencord", "listenAlongFix"), dest, { recursive: true });

    step("Building Vencord (this takes a minute)");
    // Use the pnpm version Vencord pins, no global install needed
    const pm = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).packageManager;
    // Passed through a shell on Windows, so only accept a plain pnpm version
    if (!/^pnpm@\d+\.\d+\.\d+$/.test(pm ?? "")) fail(`unexpected packageManager in Vencord's package.json: ${pm}`);
    run("npx", ["-y", pm, "install", "--frozen-lockfile"], { cwd: src });
    // --standalone matches the official installer: the in-app updater uses
    // GitHub releases instead of expecting a git checkout next to dist
    run("npx", ["-y", pm, "build", "--standalone"], { cwd: src });

    step("Closing Discord");
    closeDiscord();

    step("Backing up current Vencord build");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const backup = join(dataDir, `dist.backup-${stamp}`);
    cpSync(liveDist, backup, { recursive: true });
    console.log(`Backup: ${backup}`);

    step("Installing new build");
    const built = join(src, "dist");
    for (const base of ["patcher.js", "preload.js", "renderer.js", "renderer.css"]) {
        for (const suffix of ["", ".map", ".LEGAL.txt"]) {
            const file = join(built, base + suffix);
            if (existsSync(file)) cpSync(file, join(liveDist, base + suffix));
        }
    }

    step(`Enabling ${PLUGIN_NAME} in Vencord settings`);
    const settingsFile = join(dataDir, "settings", "settings.json");
    if (existsSync(settingsFile)) {
        const raw = readFileSync(settingsFile, "utf8");
        writeFileSync(settingsFile + ".bak", raw);
        const settings = JSON.parse(raw);
        settings.plugins ??= {};
        settings.plugins[PLUGIN_NAME] = { ...settings.plugins[PLUGIN_NAME], enabled: true };
        writeFileSync(settingsFile, JSON.stringify(settings, null, 4));
    } else {
        warn(`settings.json not found, enable '${PLUGIN_NAME}' manually in Vencord > Plugins.`);
    }

    step("Starting Discord");
    startDiscord();
}

function installSpicetify() {
    if (!has("spicetify")) fail("spicetify not found. Install Spicetify first: https://spicetify.app");

    step("Installing Spicetify extension");
    const userData = run("spicetify", ["path", "userdata"], { capture: true }).stdout.trim().split(/\r?\n/).pop();
    const extDir = join(userData, "Extensions");
    mkdirSync(extDir, { recursive: true });
    cpSync(join(ROOT, "spicetify", EXTENSION_FILE), join(extDir, EXTENSION_FILE));

    const enabled = run("spicetify", ["config", "extensions"], { capture: true }).stdout;
    if (!enabled.includes(EXTENSION_FILE)) run("spicetify", ["config", "extensions", EXTENSION_FILE]);

    // `backup apply` also re-patches Spotify if an update removed Spicetify
    const res = run("spicetify", ["backup", "apply"], { allowFail: true });
    if (res.status !== 0) run("spicetify", ["apply"]);
}

if (process.getuid?.() === 0) {
    fail("Don't run this with sudo: Vencord and Spicetify live in your user's config folder.");
}

if (!skipVencord) installVencord();
if (!skipSpicetify) installSpicetify();

console.log("\n\x1b[32mDone. Click 'Listen Along' on a friend's Spotify activity in Discord to test.\x1b[0m");
