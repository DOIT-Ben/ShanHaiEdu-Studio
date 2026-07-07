import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopDir, "..");
let serverProcess = null;
let mainWindow = null;

async function createMainWindow() {
  const port = resolveConfiguredDesktopPort() ?? (await findOpenPort());
  const appPaths = ensureDesktopDataPaths();
  serverProcess = startNextStandaloneServer({ port, appPaths });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(desktopDir, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function ensureDesktopDataPaths() {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  const artifactDir = path.join(userData, "artifact-storage-root");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  return {
    databaseUrl: process.env.DATABASE_URL?.trim() || `file:${path.join(dataDir, "shanhai-local-real-mvp.db")}`,
    artifactStorageRoot: process.env.ARTIFACT_STORAGE_ROOT?.trim() || artifactDir,
  };
}

function startNextStandaloneServer({ port, appPaths }) {
  const serverEntry = resolveStandaloneServerEntry();
  if (!serverEntry) {
    throw new Error("Next standalone server.js was not found. Run npm run build before desktop launch.");
  }

  return spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: appPaths.databaseUrl,
      ARTIFACT_STORAGE_ROOT: appPaths.artifactStorageRoot,
      NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: "api",
    },
    stdio: "ignore",
    windowsHide: true,
  });
}

function resolveStandaloneServerEntry() {
  const candidates = [
    process.env.SHANHAI_DESKTOP_SERVER_ENTRY,
    path.join(app.getAppPath(), "desktop-bundle", "server.js"),
    path.join(app.getAppPath(), ".next", "standalone", "server.js"),
    path.join(repoRoot, "desktop-bundle", "server.js"),
    path.join(repoRoot, ".next", "standalone", "server.js"),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolve(address.port);
        } else {
          reject(new Error("Could not allocate a local desktop port."));
        }
      });
    });
  });
}

function resolveConfiguredDesktopPort() {
  const rawPort = process.env.SHANHAI_DESKTOP_PORT?.trim();
  if (!rawPort) return null;
  const port = Number.parseInt(rawPort, 10);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  throw new Error("SHANHAI_DESKTOP_PORT must be an integer between 1 and 65535.");
}

function stopServerProcess() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill();
  serverProcess = null;
}

app.whenReady().then(createMainWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("before-quit", stopServerProcess);

app.on("window-all-closed", () => {
  stopServerProcess();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
