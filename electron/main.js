const { app, BrowserWindow } = require('electron');
const path = require('path');

let expressServer = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Disable webSecurity to prevent any CORS issues when MediaPipe fetches WASM and TF models from CDN
    },
    autoHideMenuBar: true
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    // In development mode, load from the Next.js dev server
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production mode, spawn a lightweight express server to serve the React files
    // This perfectly solves the Next.js absolute path (/_next/...) and file:// protocol issues
    const express = require('express');
    const serverApp = express();
    const port = Math.floor(Math.random() * 10000) + 30000;
    
    serverApp.use(express.static(path.join(__dirname, '../out')));
    
    expressServer = serverApp.listen(port, '127.0.0.1', () => {
      mainWindow.loadURL(`http://127.0.0.1:${port}`);
    });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  if (expressServer) {
    expressServer.close();
  }
});
