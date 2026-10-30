const { app, BrowserWindow, dialog } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const PORT = 32147;
const APP_URL = `http://127.0.0.1:${PORT}`;
let mainWindow;

function waitForServer(timeoutMs = 45000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(APP_URL, (response) => {
        response.resume();
        resolve();
      });

      request.setTimeout(1500, () => request.destroy());
      request.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("O servidor local não iniciou dentro do tempo esperado."));
          return;
        }
        setTimeout(check, 300);
      });
    };

    check();
  });
}

async function startLocalServer() {
  const webDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.resolve(__dirname, "..", ".next", "standalone");
  const serverEntry = path.join(webDirectory, "server.js");
  const moduleDirectory = path.join(webDirectory, "desktop_modules");
  const nextPackage = path.join(moduleDirectory, "next", "package.json");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`O servidor local não foi encontrado: ${serverEntry}`);
  }
  if (!fs.existsSync(nextPackage)) {
    throw new Error(`O pacote Next.js não foi incluído na pasta do aplicativo: ${nextPackage}. Gere novamente com npm run desktop:package.`);
  }

  process.env.NODE_ENV = "production";
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  process.env.NODE_PATH = [moduleDirectory, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  process.chdir(webDirectory);

  require(serverEntry);
  await waitForServer();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: "CODIFEX AGENDAS",
    backgroundColor: "#111827",
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  try {
    await startLocalServer();
    await createWindow();
  } catch (error) {
    console.error("Falha ao iniciar CODIFEX AGENDAS:", error);
    await dialog.showMessageBox({
      type: "error",
      title: "Não foi possível iniciar CODIFEX AGENDAS",
      message: "O aplicativo local não conseguiu iniciar.",
      detail: error instanceof Error ? error.message : String(error),
    });
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
