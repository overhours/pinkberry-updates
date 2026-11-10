"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
async function call(channel, ...args) {
    const res = (await electron_1.ipcRenderer.invoke(channel, ...args));
    if (!res.ok)
        throw new Error(res.error);
    return res.value;
}
const api = {
    saves: {
        list: () => call('saves:list'),
        load: (id) => call('saves:load', id),
        save: (id, data) => call('saves:save', id, data),
        remove: (id) => call('saves:delete', id),
        backup: (id, data) => call('saves:backup', id, data),
        exportSave: (data, name) => call('saves:export', data, name),
        importSave: () => call('saves:import'),
        openFolder: () => call('saves:openFolder'),
    },
    win: {
        minimize: () => electron_1.ipcRenderer.send('win:minimize'),
        toggleMaximize: () => electron_1.ipcRenderer.send('win:toggleMaximize'),
        close: () => electron_1.ipcRenderer.send('win:close'),
        onMaximized: (cb) => {
            const h = (_, v) => cb(v);
            electron_1.ipcRenderer.on('win:maximized', h);
            return () => electron_1.ipcRenderer.removeListener('win:maximized', h);
        },
    },
    updates: {
        check: () => call('updates:check'),
        install: () => call('updates:install'),
        restart: () => electron_1.ipcRenderer.send('updates:restart'),
        onAvailable: (cb) => {
            const h = (_, info) => cb(info);
            electron_1.ipcRenderer.on('updates:available', h);
            return () => electron_1.ipcRenderer.removeListener('updates:available', h);
        },
        onProgress: (cb) => {
            const h = (_, p) => cb(p);
            electron_1.ipcRenderer.on('updates:progress', h);
            return () => electron_1.ipcRenderer.removeListener('updates:progress', h);
        },
    },
    app: {
        onBeforeClose: (cb) => {
            const h = () => cb();
            electron_1.ipcRenderer.on('app:before-close', h);
            return () => electron_1.ipcRenderer.removeListener('app:before-close', h);
        },
        closeReady: () => electron_1.ipcRenderer.send('app:close-ready'),
        version: () => electron_1.ipcRenderer.invoke('app:version'),
    },
};
electron_1.contextBridge.exposeInMainWorld('pinkberry', api);
