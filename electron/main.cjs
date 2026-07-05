const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const PRODUCTION_URL = 'https://tahanote.com';
const DEV_URL = 'http://localhost:5173';

const isDev = !app.isPackaged;
const useBundled = process.env.DESKTOP_BUNDLE === '1';

function getLoadUrl() {
  if (isDev) return DEV_URL;
  if (useBundled) {
    return `file://${path.join(__dirname, '../dist/index.html')}`;
  }
  return PRODUCTION_URL;
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Taha Note',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#F6F4FF',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 18 },
  });

  const loadUrl = getLoadUrl();
  if (loadUrl.startsWith('file://')) {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL(loadUrl);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const isExternal =
      !url.startsWith(DEV_URL) &&
      !url.startsWith(PRODUCTION_URL) &&
      !url.startsWith('file://');

    if (isExternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
