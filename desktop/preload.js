'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,
  toggleFloat: () => ipcRenderer.invoke('float:toggle'),
  hideFloat: () => ipcRenderer.invoke('float:hide'),
  setOpacity: (value) => ipcRenderer.invoke('float:set-opacity', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('float:set-always-on-top', value),
  showMain: () => ipcRenderer.invoke('window:show-main'),
  getFloatState: () => ipcRenderer.invoke('float:get-state'),
  getShortcutStatus: () => ipcRenderer.invoke('shortcut:status'),
  openSolo: () => ipcRenderer.invoke('float:open-solo'),
  onFloatState: (cb) => ipcRenderer.on('float:state', (_event, value) => cb(value)),
  onFloatOpacity: (cb) => ipcRenderer.on('float:opacity', (_event, value) => cb(value)),
  retry: () => ipcRenderer.invoke('app:retry'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
