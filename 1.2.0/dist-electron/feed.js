"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATE_FEED = void 0;
/**
 * Where every copy of the game looks for updates.
 * This is the raw-file address of the public GitHub repo that `npm run publish-update` pushes to.
 * Leave it empty to only use the local "Pinkberry Updates" folder.
 */
exports.UPDATE_FEED = 'https://raw.githubusercontent.com/overhours/pinkberry-updates/main';
