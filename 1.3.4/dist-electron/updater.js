"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Updater = void 0;
exports.compareVersions = compareVersions;
/**
 * In-app updater.
 *
 * An update feed is a folder (or https URL) containing:
 *   manifest.json            { version, date, title, notes[], files: [{ path, sha256, size }] }
 *   <version>/dist/...       the renderer build
 *   <version>/dist-electron/ the main-process build
 *
 * Installing copies/downloads every file into userData/updates/staging-<v>,
 * verifies each SHA-256, then atomically moves it to versions/<v> and points
 * current.json at it. The bootstrap loads it on the next launch.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
function compareVersions(a, b) {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d)
            return d > 0 ? 1 : -1;
    }
    return 0;
}
const SAFE_PATH = /^(dist|dist-electron)\/[A-Za-z0-9._\-/]+$/;
class Updater {
    current;
    feed;
    updatesDir;
    constructor(userData, current, feed) {
        this.current = current;
        this.feed = feed;
        this.updatesDir = node_path_1.default.join(userData, 'updates');
    }
    isRemote() {
        return /^https?:\/\//i.test(this.feed);
    }
    async readFeed(rel) {
        if (this.isRemote()) {
            const res = await fetch(`${this.feed.replace(/\/$/, '')}/${rel}`, { cache: 'no-store' });
            if (!res.ok)
                throw new Error(`Update server returned ${res.status}`);
            return Buffer.from(await res.arrayBuffer());
        }
        return node_fs_1.default.promises.readFile(node_path_1.default.join(this.feed, rel));
    }
    async manifest() {
        try {
            const m = JSON.parse((await this.readFeed('manifest.json')).toString('utf8'));
            if (!m?.version || !Array.isArray(m.files))
                return null;
            return m;
        }
        catch {
            return null;
        }
    }
    async check() {
        const m = await this.manifest();
        if (!m)
            return { available: false, current: this.current };
        const available = compareVersions(m.version, this.current) > 0;
        return { available, current: this.current, version: m.version, title: m.title, date: m.date, notes: m.notes };
    }
    async install(onProgress) {
        const m = await this.manifest();
        if (!m)
            throw new Error('No update found');
        if (compareVersions(m.version, this.current) <= 0)
            throw new Error('Already up to date');
        for (const f of m.files)
            if (!SAFE_PATH.test(f.path) || f.path.includes('..'))
                throw new Error(`Unsafe file in update: ${f.path}`);
        const staging = node_path_1.default.join(this.updatesDir, `staging-${m.version}`);
        const target = node_path_1.default.join(this.updatesDir, 'versions', m.version);
        await node_fs_1.default.promises.rm(staging, { recursive: true, force: true });
        await node_fs_1.default.promises.mkdir(staging, { recursive: true });
        const total = m.files.length;
        let done = 0;
        for (const f of m.files) {
            const data = await this.readFeed(`${m.version}/${f.path}`);
            const hash = node_crypto_1.default.createHash('sha256').update(data).digest('hex');
            if (hash !== f.sha256)
                throw new Error(`Update file failed verification: ${f.path}`);
            const dest = node_path_1.default.join(staging, ...f.path.split('/'));
            await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(dest), { recursive: true });
            await node_fs_1.default.promises.writeFile(dest, data);
            done++;
            onProgress({ done, total, file: f.path });
        }
        // swap into place, then point current.json at it (atomic rename)
        await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(target), { recursive: true });
        await node_fs_1.default.promises.rm(target, { recursive: true, force: true });
        await node_fs_1.default.promises.rename(staging, target);
        const tmp = node_path_1.default.join(this.updatesDir, 'current.json.tmp');
        await node_fs_1.default.promises.writeFile(tmp, JSON.stringify({ version: m.version, installedAt: Date.now() }));
        await node_fs_1.default.promises.rename(tmp, node_path_1.default.join(this.updatesDir, 'current.json'));
        // keep the new version and the one before it; remove older ones
        try {
            const versions = (await node_fs_1.default.promises.readdir(node_path_1.default.join(this.updatesDir, 'versions'))).sort(compareVersions).reverse();
            for (const v of versions.slice(2))
                await node_fs_1.default.promises.rm(node_path_1.default.join(this.updatesDir, 'versions', v), { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
        return m.version;
    }
}
exports.Updater = Updater;
