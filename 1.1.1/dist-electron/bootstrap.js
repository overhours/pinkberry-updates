"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Pinkberry RNG launcher.
 *
 * The installed app ships this tiny bootstrap. On start it looks for a newer
 * game version installed by the in-app updater (userData/updates/versions/<v>)
 * and runs that; otherwise it runs the version bundled with the installer.
 * If an updated version fails to load, it falls back to the bundled one.
 * Save files live in userData/saves and are never touched by updates.
 */
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function cmp(a, b) {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d)
            return d > 0 ? 1 : -1;
    }
    return 0;
}
const bundledRoot = node_path_1.default.join(__dirname, '..');
const bundledVersion = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(bundledRoot, 'package.json'), 'utf8')).version;
const updatesDir = node_path_1.default.join(electron_1.app.getPath('userData'), 'updates');
let chosen = { root: bundledRoot, version: bundledVersion };
try {
    const cur = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(updatesDir, 'current.json'), 'utf8'));
    const root = node_path_1.default.join(updatesDir, 'versions', cur.version);
    const ok = node_fs_1.default.existsSync(node_path_1.default.join(root, 'dist-electron', 'main.js')) && node_fs_1.default.existsSync(node_path_1.default.join(root, 'dist', 'index.html'));
    if (ok && cmp(cur.version, bundledVersion) > 0)
        chosen = { root, version: cur.version };
}
catch {
    /* no updates installed yet */
}
process.env.PINKBERRY_VERSION = chosen.version;
process.env.PINKBERRY_BUNDLED_VERSION = bundledVersion;
try {
    require(node_path_1.default.join(chosen.root, 'dist-electron', 'main.js'));
}
catch (err) {
    if (chosen.root === bundledRoot)
        throw err;
    // The update could not start: forget it and run the bundled game instead.
    console.error('Updated version failed to load, falling back:', err);
    try {
        node_fs_1.default.renameSync(node_path_1.default.join(updatesDir, 'current.json'), node_path_1.default.join(updatesDir, `current.failed-${Date.now()}.json`));
    }
    catch {
        /* ignore */
    }
    process.env.PINKBERRY_VERSION = bundledVersion;
    require(node_path_1.default.join(bundledRoot, 'dist-electron', 'main.js'));
}
