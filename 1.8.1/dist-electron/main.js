"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const saves_1 = require("./saves");
const updater_1 = require("./updater");
const feed_1 = require("./feed");
const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win = null;
let store;
let updater;
let allowClose = false;
/** The running game version (an installed update may be newer than the installer). */
const APP_VERSION = process.env.PINKBERRY_VERSION || electron_1.app.getVersion();
/**
 * Where updates come from: PINKBERRY_UPDATE_FEED, then userData/updates/feed.txt (folder or https URL),
 * then the GitHub feed built into the game, then a local "Pinkberry Updates" folder.
 */
function updateFeed() {
    if (process.env.PINKBERRY_UPDATE_FEED)
        return process.env.PINKBERRY_UPDATE_FEED;
    try {
        const custom = node_fs_1.default.readFileSync(node_path_1.default.join(electron_1.app.getPath('userData'), 'updates', 'feed.txt'), 'utf8').trim();
        if (custom)
            return custom;
    }
    catch {
        /* default */
    }
    if (feed_1.UPDATE_FEED)
        return feed_1.UPDATE_FEED;
    return node_path_1.default.join(node_os_1.default.homedir(), 'Pinkberry Updates');
}
if (!electron_1.app.requestSingleInstanceLock()) {
    // A second copy would fight over the same save files.
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
}
function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1320,
        height: 840,
        minWidth: 1080,
        minHeight: 700,
        frame: false,
        show: false,
        backgroundColor: '#FFF1F6',
        title: 'Pinkberry RNG',
        icon: node_path_1.default.join(__dirname, '../build/icon.png'),
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            // keep animations and auto-roll at full speed even when the window is in the background
            backgroundThrottling: false,
        },
    });
    win.once('ready-to-show', () => win?.show());
    win.on('maximize', () => win?.webContents.send('win:maximized', true));
    win.on('unmaximize', () => win?.webContents.send('win:maximized', false));
    // Ask the renderer to save before the window actually closes.
    win.on('close', (e) => {
        if (allowClose || !win)
            return;
        e.preventDefault();
        win.webContents.send('app:before-close');
        setTimeout(() => {
            allowClose = true;
            win?.close();
        }, 3000); // never hang if the renderer is unresponsive
    });
    // Keep navigation inside the app; open external links in the browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url))
            electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (!isDev || !url.startsWith(process.env.VITE_DEV_SERVER_URL))
            e.preventDefault();
    });
    if (isDev)
        win.loadURL(process.env.VITE_DEV_SERVER_URL);
    else
        win.loadFile(node_path_1.default.join(__dirname, '../dist/index.html'));
}
function registerIpc() {
    const wrap = (fn) => async (_e, ...args) => {
        try {
            return { ok: true, value: await fn(...args) };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    };
    electron_1.ipcMain.handle('saves:list', wrap(() => store.readIndex()));
    electron_1.ipcMain.handle('saves:load', wrap((id) => store.load(id)));
    electron_1.ipcMain.handle('saves:save', wrap((id, data) => store.save(id, data)));
    electron_1.ipcMain.handle('saves:delete', wrap((id) => store.delete(id)));
    electron_1.ipcMain.handle('saves:backup', wrap((id, data) => store.backupNow(id, data)));
    electron_1.ipcMain.handle('saves:export', wrap(async (data, suggestedName) => {
        const res = await electron_1.dialog.showSaveDialog(win, {
            title: 'Export Pinkberry save',
            defaultPath: node_path_1.default.join(electron_1.app.getPath('documents'), suggestedName.replace(/[^\w\- ]/g, '') + '.pinkberry.json'),
            filters: [{ name: 'Pinkberry save', extensions: ['json'] }],
        });
        if (res.canceled || !res.filePath)
            return { canceled: true };
        node_fs_1.default.writeFileSync(res.filePath, JSON.stringify(saves_1.SaveStore.makeEnvelope(data), null, 2), 'utf8');
        return { canceled: false, path: res.filePath };
    }));
    electron_1.ipcMain.handle('saves:import', wrap(async () => {
        const res = await electron_1.dialog.showOpenDialog(win, {
            title: 'Import Pinkberry save',
            properties: ['openFile'],
            filters: [{ name: 'Pinkberry save', extensions: ['json'] }],
        });
        if (res.canceled || !res.filePaths[0])
            return { canceled: true };
        const stat = node_fs_1.default.statSync(res.filePaths[0]);
        if (stat.size > 20 * 1024 * 1024)
            throw new Error('File is too large to be a save');
        const { data } = saves_1.SaveStore.openEnvelope(node_fs_1.default.readFileSync(res.filePaths[0], 'utf8'));
        return { canceled: false, data };
    }));
    electron_1.ipcMain.handle('saves:openFolder', wrap(() => electron_1.shell.openPath(node_path_1.default.join(electron_1.app.getPath('userData'), 'saves'))));
    electron_1.ipcMain.on('win:minimize', () => win?.minimize());
    electron_1.ipcMain.on('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
    electron_1.ipcMain.on('win:close', () => win?.close());
    electron_1.ipcMain.on('app:close-ready', () => {
        allowClose = true;
        win?.close();
    });
    electron_1.ipcMain.handle('app:version', () => APP_VERSION);
    // ── updates ──
    electron_1.ipcMain.handle('updates:check', wrap(() => updater.check()));
    electron_1.ipcMain.handle('updates:install', wrap(() => updater.install((p) => win?.webContents.send('updates:progress', p))));
    electron_1.ipcMain.on('updates:restart', () => {
        allowClose = true;
        electron_1.app.relaunch();
        electron_1.app.exit(0);
    });
}
/** Look for updates shortly after launch and then every 10 minutes. */
function scheduleUpdateChecks() {
    const run = async () => {
        try {
            const info = await updater.check();
            if (info.available)
                win?.webContents.send('updates:available', info);
        }
        catch {
            /* offline or no feed: ignore */
        }
    };
    setTimeout(run, 4000);
    setInterval(run, 10 * 60 * 1000);
}
electron_1.app.whenReady().then(() => {
    store = new saves_1.SaveStore(electron_1.app.getPath('userData'));
    updater = new updater_1.Updater(electron_1.app.getPath('userData'), APP_VERSION, updateFeed());
    registerIpc();
    createWindow();
    scheduleUpdateChecks();
});
electron_1.app.on('window-all-closed', () => electron_1.app.quit());
