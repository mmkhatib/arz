// Arz desktop wrapper — thin Electron shell.
//
// This file does NOT bundle the UI. It loads http://127.0.0.1:7777, which
// the gateway serves. So:
//   - UI changes → just `vite build` (or run dev server). No Electron rebuild.
//   - This file changes → `npm run package` to repackage the app.
//
// The wrapper auto-starts the gateway in the background (best-effort) so
// users only need to launch the desktop app.

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const GATEWAY_URL = process.env.ARZ_GATEWAY_URL || "http://127.0.0.1:7777";
const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = 7777;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 300;

let mainWindow = null;
let gatewayProc = null;

function probeGateway() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: GATEWAY_HOST, port: GATEWAY_PORT, method: "GET", path: "/", timeout: 1000 },
      (res) => { resolve(res.statusCode != null && res.statusCode < 500); res.resume(); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitForGateway() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeGateway()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function spawnGateway() {
  // Try `arz gateway` (installed via uv/pip), then `uv run arz gateway` from
  // the project dir if we're running from source.
  const candidates = [
    { cmd: "arz", args: ["gateway"] },
    { cmd: "uv", args: ["run", "arz", "gateway"], cwd: path.resolve(__dirname, "..") },
  ];
  for (const c of candidates) {
    try {
      const proc = spawn(c.cmd, c.args, {
        cwd: c.cwd,
        stdio: "ignore",
        detached: false,
        env: { ...process.env },
      });
      proc.on("error", () => { /* will fall through to next candidate */ });
      gatewayProc = proc;
      return proc;
    } catch (_) {
      // try next
    }
  }
  return null;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        { label: "New session", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.executeJavaScript("window.location.hash = '#new'") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload", accelerator: "CmdOrCtrl+R" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [{ type: "separator" }, { role: "front" }] : [])],
    },
    {
      role: "help",
      submenu: [
        { label: "Open docs", click: () => shell.openExternal("https://github.com/mmkhatib/arz") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Arz",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: "#0e0e10",
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // External links open in the system browser, not in the Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(GATEWAY_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // If gateway isn't up, start it. Show a loading screen meanwhile.
  await mainWindow.loadFile(path.join(__dirname, "loading.html")).catch(() => {});

  let up = await probeGateway();
  if (!up) {
    spawnGateway();
    up = await waitForGateway();
  }
  if (!up) {
    dialog.showErrorBox(
      "Arz gateway unreachable",
      `Could not start or reach the gateway at ${GATEWAY_URL}.\n\n` +
      `Try starting it manually:\n  arz gateway\n\nThen reopen this app.`,
    );
    return;
  }

  await mainWindow.loadURL(GATEWAY_URL);
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // We didn't take ownership of the gateway aggressively (it might be a
  // long-running install someone else wants to keep). Only kill if we
  // actually spawned it.
  if (gatewayProc && !gatewayProc.killed) {
    try { gatewayProc.kill(); } catch (_) {}
  }
});
