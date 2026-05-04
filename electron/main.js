// Arz desktop wrapper — thin Electron shell that fully owns the gateway
// lifecycle.
//
// Lifecycle rules:
//   - On launch, if the gateway isn't already running on 127.0.0.1:7777,
//     we spawn it. We track whether we spawned it (vs found it pre-running).
//   - We DO NOT kill a gateway someone else started (could be the user's
//     dev server, another tab/instance). We only kill what we own.
//   - On full app exit, we kill the spawned gateway with SIGTERM, give it
//     5s to exit cleanly, then SIGKILL if it's still alive.
//   - On macOS, "all windows closed" doesn't quit by default — but for
//     this app we DO want to quit (so the gateway dies). The user can
//     still relaunch from the dock.
//
// UI lives at the gateway, so:
//   - Frontend changes → vite build, reload window. No Electron rebuild.
//   - Wrapper changes (this file) → npm run package.

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");

const GATEWAY_URL = process.env.ARZ_GATEWAY_URL || "http://127.0.0.1:7777";
const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = 7777;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 300;
const SHUTDOWN_GRACE_MS = 5_000;

let mainWindow = null;
let gatewayProc = null;          // Process handle if WE spawned it
let gatewaySpawnedByUs = false;  // Don't kill what we didn't start
let appQuitting = false;         // Set in before-quit so we don't try to restart on intentional exit

// Restart-burst protection — if the gateway crashes more than RESTART_BURST_LIMIT
// times within RESTART_WINDOW_MS, stop respawning and show an error dialog.
// Mirrors the systemd StartLimitBurst pattern. Without this, a bad config or
// stale binary path could loop forever and chew CPU.
const RESTART_BURST_LIMIT = 5;
const RESTART_WINDOW_MS = 60_000;
const restartTimes = [];          // Timestamps of recent (re)starts

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

function tryStartGateway() {
  // Try `arz gateway` (installed via uv/pip), then `uv run arz gateway`
  // from the project root if we're running from source.
  const projectRoot = path.resolve(__dirname, "..");
  const candidates = [
    { cmd: "arz", args: ["gateway"], cwd: projectRoot },
    { cmd: "uv", args: ["run", "arz", "gateway"], cwd: projectRoot },
  ];
  for (const c of candidates) {
    try {
      const proc = spawn(c.cmd, c.args, {
        cwd: c.cwd,
        stdio: "ignore",
        // Don't detach — we want the OS to clean it up if Electron crashes,
        // and we want to be able to kill it on graceful exit.
        detached: false,
        env: { ...process.env },
      });
      // If `spawn` succeeds but the binary doesn't exist, we'll get an
      // 'error' event. Wait briefly to detect that.
      let errored = false;
      proc.once("error", () => { errored = true; });
      // Synchronous-ish bail: if PID is undefined or the process dies
      // immediately, try the next candidate.
      if (proc.pid && !errored) {
        gatewayProc = proc;
        gatewaySpawnedByUs = true;
        const now = Date.now();
        restartTimes.push(now);
        while (restartTimes.length && now - restartTimes[0] > RESTART_WINDOW_MS) {
          restartTimes.shift();
        }
        proc.once("exit", (code, signal) => {
          gatewayProc = null;
          gatewaySpawnedByUs = false;
          if (appQuitting) return;
          // Auto-restart on unexpected exit, with burst protection.
          if (restartTimes.length >= RESTART_BURST_LIMIT) {
            dialog.showErrorBox(
              "Arz gateway keeps crashing",
              `The gateway exited ${restartTimes.length} times in the last ` +
                `${Math.round(RESTART_WINDOW_MS / 1000)}s and has been stopped to ` +
                `avoid a restart loop.\n\nLast exit code: ${code}, signal: ${signal}\n\n` +
                `Run \`arz gateway\` from a terminal to see the error.`,
            );
            app.quit();
            return;
          }
          tryStartGateway();
        });
        return proc;
      }
    } catch (_) {
      // try next
    }
  }
  return null;
}

function killGatewayIfOurs() {
  if (!gatewaySpawnedByUs || !gatewayProc) return Promise.resolve();
  if (gatewayProc.killed || gatewayProc.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };
    gatewayProc.once("exit", finish);
    try {
      gatewayProc.kill("SIGTERM");
    } catch (_) {
      finish();
      return;
    }
    setTimeout(() => {
      if (!resolved && gatewayProc && !gatewayProc.killed) {
        try { gatewayProc.kill("SIGKILL"); } catch (_) {}
      }
    }, SHUTDOWN_GRACE_MS);
    setTimeout(finish, SHUTDOWN_GRACE_MS + 500);
  });
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(GATEWAY_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  await mainWindow.loadFile(path.join(__dirname, "loading.html")).catch(() => {});

  let up = await probeGateway();
  if (!up) {
    tryStartGateway();
    up = await waitForGateway();
  }
  if (!up) {
    dialog.showErrorBox(
      "Arz gateway unreachable",
      `Could not start or reach the gateway at ${GATEWAY_URL}.\n\n` +
      `Try starting it manually:\n  arz gateway\n\nThen reopen this app.`,
    );
    app.quit();
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

// On every platform, when the user closes all windows we want the wrapper
// to fully exit so the gateway dies with it. Without this, on macOS the
// app stays in the dock and the gateway keeps running silently.
app.on("window-all-closed", () => {
  app.quit();
});

// before-quit fires before the app actually exits, while async work can
// still complete. We use it to take down the gateway cleanly.
app.on("before-quit", async (e) => {
  appQuitting = true;
  if (gatewaySpawnedByUs && gatewayProc && !gatewayProc.killed) {
    e.preventDefault();
    await killGatewayIfOurs();
    app.exit(0);
  }
});

// Last-resort cleanup if we somehow exit without going through before-quit.
process.on("exit", () => {
  if (gatewaySpawnedByUs && gatewayProc && !gatewayProc.killed) {
    try { gatewayProc.kill("SIGKILL"); } catch (_) {}
  }
});
process.on("SIGINT", () => { app.quit(); });
process.on("SIGTERM", () => { app.quit(); });
