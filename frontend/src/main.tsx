import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "highlight.js/styles/atom-one-dark.css";
import App from "./App.tsx";
import { DialogProvider } from "./components/Dialog";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>
);

// Register the PWA service worker. Only in production builds — Vite's dev
// server doesn't ship the public/sw.js the same way, and SWs in dev
// complicate hot reload.
if ("serviceWorker" in navigator && (import.meta as { env?: { PROD?: boolean } }).env?.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
