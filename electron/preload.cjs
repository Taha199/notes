const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('tahaNoteDesktop', {
  isDesktop: true,
  platform: process.platform,
});
