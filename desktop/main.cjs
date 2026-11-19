const { app, BrowserWindow, dialog } = require("electron");
const net = require("node:net");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

// 1. Garante instância única IMEDIATAMENTE (antes de qualquer processamento pesado)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Já existe uma instância rodando. Encerra imediatamente sem deixar processo fantasma.
  app.exit(0);
}

// Registra o protocolo customizado codifex-agendas:// no Windows
// Isso permite que links na web com codifex-agendas:// abram o executável diretamente
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("codifex-agendas", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("codifex-agendas");
}

const PORT = 32147;
const APP_URL = `http://127.0.0.1:${PORT}`;
let mainWindow = null;
let isQuitting = false;

// 2. Se o usuário tentar abrir novamente com o app já em execução, foca ou recria a janela
app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    createMainWindow().catch(console.error);
  }
});

// 3. Carregamento resiliente do server.env
function loadServerEnv() {
  const userDataDir = app.getPath("userData");
  const targetFile = path.join(userDataDir, "server.env");

  const candidates = [
    path.resolve(__dirname, "..", ".env.local"),
    path.resolve(__dirname, "..", "server.env"),
    path.join(process.resourcesPath || "", "server.env"),
    path.join(process.resourcesPath || "", "web", ".env.local"),
    path.join(process.resourcesPath || "", "web", "server.env"),
  ];

  let syncedFromCandidate = false;
  for (const cand of candidates) {
    if (cand && fs.existsSync(cand)) {
      try {
        const content = fs.readFileSync(cand, "utf8");
        for (const line of content.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
          if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.writeFileSync(targetFile, content, "utf8");
        syncedFromCandidate = true;
        break;
      } catch (_) {}
    }
  }

  if (!syncedFromCandidate && fs.existsSync(targetFile)) {
    try {
      const content = fs.readFileSync(targetFile, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch (e) {
      console.error("Erro ao ler server.env:", e);
    }
  }
}

// 4. Verificação de prontidão do servidor via socket TCP direto
// Não faz GET pesado no Next.js nem aborta requisições prematuramente
function waitForServer(port = PORT, host = "127.0.0.1", timeoutMs = 60000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error("O servidor local demorou muito para responder e não iniciou dentro do tempo limite."));
      }

      const socket = new net.Socket();
      socket.setTimeout(2000);

      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.on("timeout", () => {
        socket.destroy();
        setTimeout(check, 250);
      });

      socket.on("error", () => {
        socket.destroy();
        setTimeout(check, 250);
      });

      socket.connect(port, host);
    }

    check();
  });
}

// 5. Inicialização do servidor Next.js standalone
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
  await waitForServer(PORT, "127.0.0.1");
}

// 6. Tela inicial de carregamento instantâneo
function getLoadingHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>CODIFEX AGENDAS</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: #0b0f19;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          overflow: hidden;
          user-select: none;
        }
        .container {
          text-align: center;
          animation: fadeIn 0.4s ease-out;
        }
        .title {
          font-size: 24px;
          font-weight: 700;
          letter-spacing: 2px;
          margin-bottom: 8px;
          color: #f1f5f9;
        }
        .subtitle {
          font-size: 13px;
          color: #94a3b8;
          margin-bottom: 24px;
        }
        .spinner {
          width: 36px;
          height: 36px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="title">CODIFEX AGENDAS</div>
        <div class="subtitle">Inicializando ambiente de trabalho...</div>
        <div class="spinner"></div>
      </div>
    </body>
    </html>
  `)}`;
}

// 7. Criação da Janela com abertura visual imediata
async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  const iconCandidates = [
    path.join(__dirname, "..", "public", "icon.png"),
    path.join(__dirname, "..", "public", "icon.ico"),
    path.join(process.resourcesPath || "", "icon.png"),
  ];
  const appIcon = iconCandidates.find(p => p && fs.existsSync(p));

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: "CODIFEX AGENDAS",
    backgroundColor: "#0b0f19",
    autoHideMenuBar: true,
    show: true,
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Apresenta a tela de inicialização instantaneamente enquanto o servidor conecta
  await mainWindow.loadURL(getLoadingHtml()).catch(() => {});
}

// 8. Inicialização do Electron
app.whenReady().then(async () => {
  loadServerEnv();

  // Abre a janela imediatamente para o usuário ter feedback visual imediato
  await createMainWindow();

  try {
    // Inicia o servidor local Next.js
    await startLocalServer();

    // Carrega a URL da aplicação com retentativas seguras caso o Next.js termine o SSR
    if (mainWindow && !mainWindow.isDestroyed()) {
      let loaded = false;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          await mainWindow.loadURL(APP_URL);
          loaded = true;
          break;
        } catch (err) {
          if (attempt === 6) throw err;
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }
  } catch (error) {
    console.error("Falha ao iniciar CODIFEX AGENDAS:", error);
    if (!isQuitting) {
      await dialog.showMessageBox({
        type: "error",
        title: "Não foi possível iniciar CODIFEX AGENDAS",
        message: "O aplicativo local não conseguiu iniciar.",
        detail: error instanceof Error ? error.message : String(error),
      });
      app.exit(1);
    }
  }
});

// 9. Fechamento total e eliminação de processos zumbis
app.on("window-all-closed", () => {
  isQuitting = true;
  app.quit();
  setTimeout(() => {
    process.exit(0);
  }, 100).unref();
});

app.on("will-quit", () => {
  isQuitting = true;
  process.exit(0);
});
