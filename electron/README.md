# Arz desktop wrapper

Thin Electron shell that loads `http://127.0.0.1:7777` (the arz gateway).

## Why a thin wrapper?

The UI lives at the gateway. Electron just provides the chrome. So:

- **UI changes** → `cd ../frontend && ./node_modules/.bin/vite build` and reload the window. **No Electron rebuild.**
- **Gateway/backend changes** → restart the gateway. **No Electron rebuild.**
- **This wrapper changes** (menu bar, IPC, etc.) → `npm run package`.

## Run from source

```sh
cd electron
npm install
npm start            # dev, opens a window pointing at the gateway
```

If the gateway isn't already running, the wrapper tries:
1. `arz gateway` (system PATH)
2. `uv run arz gateway` from the project root

If both fail, you'll get a dialog telling you to run it manually.

## Package a `.dmg` / `.app`

```sh
cd electron
npm install
npm run package      # builds for the host arch (mac/x64/arm64)
```

Output lands in `electron/dist/`.

## Configuration

Set `ARZ_GATEWAY_URL` to point the wrapper at a remote gateway:

```sh
ARZ_GATEWAY_URL=http://my-server:7777 npm start
```
