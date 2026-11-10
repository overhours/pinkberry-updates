"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaveStore = void 0;
/**
 * Local save storage for Pinkberry RNG.
 *
 *  userData/saves/index.json            profile list
 *  userData/saves/<id>.json             current save (envelope with checksum)
 *  userData/saves/backups/<id>/*.json   rotating backups
 *
 * Writes are atomic (write temp file, fsync, rename) so a crash mid-save can
 * never leave a half-written file. Loads verify a SHA-256 checksum and fall
 * back to the newest valid backup if the main file is damaged.
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKUPS = 12;
const ID_RE = /^[a-z0-9-]{4,64}$/i;
class SaveStore {
    root;
    lastBackupAt = new Map();
    constructor(userData) {
        this.root = node_path_1.default.join(userData, 'saves');
        node_fs_1.default.mkdirSync(node_path_1.default.join(this.root, 'backups'), { recursive: true });
    }
    assertId(id) {
        if (!ID_RE.test(id))
            throw new Error('Invalid profile id');
    }
    savePath(id) {
        return node_path_1.default.join(this.root, `${id}.json`);
    }
    backupDir(id) {
        return node_path_1.default.join(this.root, 'backups', id);
    }
    atomicWrite(file, content) {
        const tmp = `${file}.${process.pid}.tmp`;
        const fd = node_fs_1.default.openSync(tmp, 'w');
        try {
            node_fs_1.default.writeSync(fd, content, 0, 'utf8');
            node_fs_1.default.fsyncSync(fd);
        }
        finally {
            node_fs_1.default.closeSync(fd);
        }
        node_fs_1.default.renameSync(tmp, file);
    }
    static checksum(data) {
        return node_crypto_1.default.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }
    static makeEnvelope(data) {
        return { format: 'pinkberry-save', version: 1, savedAt: Date.now(), checksum: SaveStore.checksum(data), data };
    }
    /** Parse & verify an envelope. Returns the data or throws. */
    static openEnvelope(text) {
        const env = JSON.parse(text);
        if (!env || env.format !== 'pinkberry-save' || env.data === undefined)
            throw new Error('Not a Pinkberry save file');
        if (SaveStore.checksum(env.data) !== env.checksum)
            throw new Error('Checksum mismatch (file is damaged)');
        return { data: env.data, savedAt: env.savedAt };
    }
    // ───────── index ─────────
    readIndex() {
        const file = node_path_1.default.join(this.root, 'index.json');
        try {
            const idx = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
            if (!Array.isArray(idx.profiles))
                throw new Error('bad index');
            // drop entries whose save no longer exists
            idx.profiles = idx.profiles.filter((p) => ID_RE.test(p.id) && (node_fs_1.default.existsSync(this.savePath(p.id)) || node_fs_1.default.existsSync(this.backupDir(p.id))));
            // self-heal: any valid save file missing from the index is added back
            const known = new Set(idx.profiles.map((p) => p.id));
            let healed = false;
            for (const f of node_fs_1.default.readdirSync(this.root)) {
                const m = /^([a-z0-9-]+)\.json$/i.exec(f);
                if (!m || f === 'index.json' || known.has(m[1]) || !ID_RE.test(m[1]))
                    continue;
                const loaded = this.load(m[1]);
                if (!loaded.data)
                    continue;
                const summary = SaveStore.summarize(m[1], loaded.data);
                try {
                    summary.lastPlayed = node_fs_1.default.statSync(this.savePath(m[1])).mtimeMs;
                }
                catch {
                    /* keep default */
                }
                idx.profiles.push(summary);
                healed = true;
            }
            if (healed) {
                try {
                    this.writeIndex(idx);
                }
                catch {
                    /* best effort */
                }
            }
            return idx;
        }
        catch {
            return this.rebuildIndex();
        }
    }
    writeIndex(idx) {
        this.atomicWrite(node_path_1.default.join(this.root, 'index.json'), JSON.stringify(idx, null, 2));
    }
    /** Reconstruct the profile list by scanning save files (index corruption recovery). */
    rebuildIndex() {
        const profiles = [];
        for (const f of node_fs_1.default.readdirSync(this.root)) {
            const m = /^([a-z0-9-]+)\.json$/i.exec(f);
            if (!m || f === 'index.json')
                continue;
            const loaded = this.load(m[1]);
            if (loaded.data)
                profiles.push(SaveStore.summarize(m[1], loaded.data));
        }
        const idx = { profiles, lastProfileId: profiles[0]?.id ?? null };
        try {
            this.writeIndex(idx);
        }
        catch {
            /* ignore */
        }
        return idx;
    }
    static summarize(id, data) {
        const d = data;
        return {
            id,
            username: String(d?.profile?.username ?? 'Berry'),
            avatar: String(d?.profile?.avatar ?? 'strawberry'),
            title: String(d?.profile?.title ?? ''),
            lastPlayed: Date.now(),
            totalRolls: Number(d?.stats?.totalRolls ?? 0) || 0,
            discoveries: d?.discoveries ? Object.keys(d.discoveries).length : 0,
            rebirths: Number(d?.rebirths ?? 0) || 0,
        };
    }
    // ───────── saves ─────────
    save(id, data) {
        this.assertId(id);
        const env = SaveStore.makeEnvelope(data);
        const text = JSON.stringify(env);
        // Verify round-trip before touching disk.
        SaveStore.openEnvelope(text);
        this.atomicWrite(this.savePath(id), text);
        this.maybeBackup(id, text);
        const idx = this.readIndex();
        const summary = SaveStore.summarize(id, data);
        const i = idx.profiles.findIndex((p) => p.id === id);
        if (i >= 0)
            idx.profiles[i] = summary;
        else
            idx.profiles.push(summary);
        idx.lastProfileId = id;
        this.writeIndex(idx);
        return { savedAt: env.savedAt };
    }
    maybeBackup(id, text, force = false) {
        const now = Date.now();
        if (!force && now - (this.lastBackupAt.get(id) ?? 0) < BACKUP_INTERVAL_MS)
            return;
        this.lastBackupAt.set(id, now);
        const dir = this.backupDir(id);
        node_fs_1.default.mkdirSync(dir, { recursive: true });
        this.atomicWrite(node_path_1.default.join(dir, `${now}.json`), text);
        const files = node_fs_1.default.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort();
        while (files.length > MAX_BACKUPS)
            node_fs_1.default.rmSync(node_path_1.default.join(dir, files.shift()), { force: true });
    }
    load(id) {
        this.assertId(id);
        const candidates = [{ file: this.savePath(id), label: 'main' }];
        const dir = this.backupDir(id);
        if (node_fs_1.default.existsSync(dir)) {
            for (const f of node_fs_1.default.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort().reverse()) {
                candidates.push({ file: node_path_1.default.join(dir, f), label: `backup from ${new Date(Number(f.replace('.json', ''))).toLocaleString()}` });
            }
        }
        let firstError;
        for (const c of candidates) {
            try {
                if (!node_fs_1.default.existsSync(c.file))
                    continue;
                const { data } = SaveStore.openEnvelope(node_fs_1.default.readFileSync(c.file, 'utf8'));
                if (c.label !== 'main') {
                    // Preserve the damaged file for inspection, then restore the backup as main.
                    if (node_fs_1.default.existsSync(this.savePath(id)))
                        node_fs_1.default.copyFileSync(this.savePath(id), `${this.savePath(id)}.corrupt-${Date.now()}`);
                    this.atomicWrite(this.savePath(id), JSON.stringify(SaveStore.makeEnvelope(data)));
                }
                return { data, recoveredFrom: c.label === 'main' ? undefined : c.label };
            }
            catch (e) {
                firstError ??= `${c.label}: ${e.message}`;
            }
        }
        return { data: null, error: firstError ?? 'No save found' };
    }
    delete(id) {
        this.assertId(id);
        node_fs_1.default.rmSync(this.savePath(id), { force: true });
        node_fs_1.default.rmSync(this.backupDir(id), { recursive: true, force: true });
        const idx = this.readIndex();
        idx.profiles = idx.profiles.filter((p) => p.id !== id);
        if (idx.lastProfileId === id)
            idx.lastProfileId = idx.profiles[0]?.id ?? null;
        this.writeIndex(idx);
    }
    backupNow(id, data) {
        this.assertId(id);
        this.maybeBackup(id, JSON.stringify(SaveStore.makeEnvelope(data)), true);
    }
}
exports.SaveStore = SaveStore;
