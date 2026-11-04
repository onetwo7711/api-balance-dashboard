'use strict';

/**
 * API账户余额看板 · 桌面应用主进程
 * 复用既有的 server.js 本地服务与 public 页面，不改动任何业务逻辑。
 * 提供两种运行形态：主窗口（完整界面）与悬浮窗（紧凑常驻）。
 */

const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT, 'server.js');
const FALLBACK_PAGE = path.join(__dirname, 'fallback.html');
const USER_DATA = app.getPath('userData');
const STATE_FILE = path.join(USER_DATA, 'window-state.json');

const DEFAULT_STATE = {
  main: { width: 1120, height: 780, x: null, y: null },
  float: { width: 400, height: 520, x: null, y: null, opacity: 0.95, alwaysOnTop: true },
};

let mainWindow = null;
let floatWindow = null;
let serverAddress = '';
let state = loadState();
let shortcuts = [];

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      main: { ...DEFAULT_STATE.main, ...(raw.main || {}) },
      float: { ...DEFAULT_STATE.float, ...(raw.float || {}) },
    };
  } catch {
    return { main: { ...DEFAULT_STATE.main }, float: { ...DEFAULT_STATE.float } };
  }
}

function saveState() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('窗口状态保存失败：', err.message);
  }
}

function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.95;
  return Math.min(1, Math.max(0.3, n));
}

/** 依据当前显示器工作区校正窗口尺寸与位置，适配多显示器与不同分辨率。 */
function clampBounds(bounds, minWidth, minHeight) {
  const display = screen.getDisplayMatching({
    x: Number.isFinite(bounds.x) ? bounds.x : 0,
    y: Number.isFinite(bounds.y) ? bounds.y : 0,
    width: bounds.width || minWidth,
    height: bounds.height || minHeight,
  });
  const area = display.workArea;
  const width = Math.min(Math.max(bounds.width || minWidth, minWidth), area.width);
  const height = Math.min(Math.max(bounds.height || minHeight, minHeight), area.height);
  let x = bounds.x;
  let y = bounds.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    x = Math.round(area.x + (area.width - width) / 2);
    y = Math.round(area.y + (area.height - height) / 2);
  } else {
    x = Math.min(Math.max(x, area.x), area.x + area.width - width);
    y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  }
  return { x, y, width, height };
}

async function startLocalServer() {
  const { startServer } = require(SERVER_ENTRY);
  for (let port = 8787; port <= 8806; port += 1) {
    try {
      const result = await startServer({
        port,
        host: '127.0.0.1',
        open: false,
        dataDir: app.isPackaged ? path.join(USER_DATA, 'data') : undefined,
      });
      return result;
    } catch (err) {
      if (err.code !== 'PORT_IN_USE') throw err;
    }
  }
  throw new Error('8787至8806端口均被占用，无法启动本地服务');
}

function rememberMainBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  state.main = { ...state.main, ...bounds };
  saveState();
}

function rememberFloatBounds() {
  if (!floatWindow || floatWindow.isDestroyed()) return;
  const bounds = floatWindow.getBounds();
  state.float = { ...state.float, ...bounds };
  saveState();
}

function createMainWindow() {
  const bounds = clampBounds(state.main, 720, 520);
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'API账户余额看板',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', rememberMainBounds);
  mainWindow.on('move', rememberMainBounds);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-fail-load', (event, code, description, url) => {
    if (code === -3) return;
    console.error('页面加载失败：', code, description, url);
    mainWindow.loadFile(FALLBACK_PAGE, { query: { address: serverAddress } });
  });
  mainWindow.loadURL(serverAddress);
  return mainWindow;
}

function createFloatWindow() {
  const bounds = clampBounds(state.float, 280, 260);
  floatWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 280,
    minHeight: 260,
    frame: false,
    transparent: true,
    resizable: true,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: state.float.alwaysOnTop !== false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  floatWindow.setAlwaysOnTop(state.float.alwaysOnTop !== false, 'floating');
  if (process.platform !== 'linux') {
    try { floatWindow.setOpacity(clampOpacity(state.float.opacity)); } catch (err) { console.error('设置透明度失败：', err.message); }
  }
  floatWindow.on('resize', rememberFloatBounds);
  floatWindow.on('move', rememberFloatBounds);
  floatWindow.on('closed', () => { floatWindow = null; });
  floatWindow.loadURL(`${serverAddress}/?mode=float`);
  return floatWindow;
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleFloat() {
  if (!floatWindow || floatWindow.isDestroyed()) {
    createFloatWindow();
    return;
  }
  if (floatWindow.isVisible()) floatWindow.hide();
  else { floatWindow.show(); floatWindow.focus(); }
}

function setFloatOpacity(value) {
  state.float.opacity = clampOpacity(value);
  saveState();
  if (floatWindow && !floatWindow.isDestroyed() && process.platform !== 'linux') {
    try { floatWindow.setOpacity(state.float.opacity); } catch (err) { console.error('设置透明度失败：', err.message); }
  }
  return state.float.opacity;
}

function setFloatAlwaysOnTop(value) {
  state.float.alwaysOnTop = Boolean(value);
  saveState();
  if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.setAlwaysOnTop(state.float.alwaysOnTop, 'floating');
  }
  return state.float.alwaysOnTop;
}

function registerShortcuts() {
  const bindings = [
    { accelerator: 'CommandOrControl+Shift+B', action: () => toggleFloat() },
    { accelerator: 'CommandOrControl+Shift+W', action: () => showMain() },
  ];
  shortcuts = bindings.map((item) => {
    let ok = false;
    try { ok = globalShortcut.register(item.accelerator, item.action); } catch (err) { ok = false; }
    if (!ok) console.error(`全局快捷键注册失败：${item.accelerator}`);
    return { accelerator: item.accelerator, ok };
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '窗口',
      submenu: [
        { label: '显示主窗口', accelerator: 'CommandOrControl+Shift+W', click: () => showMain() },
        { label: '显示／隐藏悬浮窗', accelerator: 'CommandOrControl+Shift+B', click: () => toggleFloat() },
        { type: 'separator' },
        {
          label: '悬浮窗透明度',
          submenu: [100, 90, 80, 70].map((percent) => ({
            label: `${percent}%`,
            type: 'radio',
            checked: Math.round(state.float.opacity * 100) === percent,
            click: () => setFloatOpacity(percent / 100),
          })),
        },
        {
          label: '悬浮窗置顶',
          type: 'checkbox',
          checked: state.float.alwaysOnTop !== false,
          click: (item) => setFloatAlwaysOnTop(item.checked),
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载界面' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('float:toggle', () => { toggleFloat(); return Boolean(floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible()); });
  ipcMain.handle('float:hide', () => { if (floatWindow && !floatWindow.isDestroyed()) floatWindow.hide(); return true; });
  ipcMain.handle('float:set-opacity', (_event, value) => setFloatOpacity(value));
  ipcMain.handle('float:set-always-on-top', (_event, value) => setFloatAlwaysOnTop(value));
  ipcMain.handle('window:show-main', () => { showMain(); return true; });
  ipcMain.handle('float:get-state', () => ({
    opacity: state.float.opacity,
    alwaysOnTop: state.float.alwaysOnTop !== false,
    opacitySupported: process.platform !== 'linux',
    shortcuts,
  }));
  ipcMain.handle('shortcut:status', () => shortcuts);
  ipcMain.handle('app:retry', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(serverAddress); return true; });
  ipcMain.handle('app:quit', () => { app.quit(); return true; });
}

app.whenReady().then(async () => {
  try {
    const result = await startLocalServer();
    serverAddress = result.address;
  } catch (err) {
    dialog.showErrorBox('本地服务启动失败', `${err.message}\n请关闭占用端口的程序后重试。`);
    app.quit();
    return;
  }
  registerIpc();
  buildMenu();
  registerShortcuts();
  createMainWindow();
  if (process.argv.includes('--float') || process.env.DESKTOP_FLOAT === '1') {
    createFloatWindow();
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('second-instance', () => { showMain(); });
if (!app.requestSingleInstanceLock()) app.quit();
