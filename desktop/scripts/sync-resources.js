'use strict';

/**
 * 打包前把项目根目录的服务端与页面资源同步到desktop/resources，
 * 供 electron-builder 打进应用包（extraResources）。
 */

const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_DIR = path.join(__dirname, '..');
const PROJECT_DIR = path.join(DESKTOP_DIR, '..');
const TARGET_DIR = path.join(DESKTOP_DIR, 'resources');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

fs.rmSync(TARGET_DIR, { recursive: true, force: true });
fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.copyFileSync(path.join(PROJECT_DIR, 'server.js'), path.join(TARGET_DIR, 'server.js'));
copyDir(path.join(PROJECT_DIR, 'public'), path.join(TARGET_DIR, 'public'));
console.log('资源已同步到 desktop/resources');
